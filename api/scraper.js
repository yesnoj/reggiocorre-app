// api/scraper.js - Vercel Serverless Function
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

  try {
    console.log('Fetching data from ReggioCorre...');
    
    const response = await fetch('https://www.reggiocorre.it/calendario.aspx');
    const html = await response.text();
    
    console.log('HTML length:', html.length);
    
    // DEBUG MODE: Se c'è il parametro ?debug=true mostra l'HTML grezzo
    if (req.query.debug === 'true') {
      const dom = new JSDOM(html);
      const document = dom.window.document;
      
      // Cerca il contenuto principale
      const bodyText = document.body.textContent.substring(0, 5000);
      
      return res.status(200).json({
        debug: true,
        htmlLength: html.length,
        bodyPreview: bodyText,
        tableCount: document.querySelectorAll('table').length,
        rowCount: document.querySelectorAll('tr').length
      });
    }
    
    const races = parseReggioCorre(html);
    
    console.log(`Found ${races.length} races`);
    
    // Filtra solo gare dei prossimi 2 mesi
    const now = new Date();
    const twoMonthsLater = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    
    const filteredRaces = races.filter(race => {
      const raceDate = new Date(race.date);
      return raceDate >= now && raceDate <= twoMonthsLater;
    });
    
    res.status(200).json({
      success: true,
      count: filteredRaces.length,
      totalParsed: races.length,
      lastUpdate: new Date().toISOString(),
      races: filteredRaces
    });
    
  } catch (error) {
    console.error('Error scraping:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
}

function parseReggioCorre(html) {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const races = [];
  
  // Strategia alternativa: cerca tutto il testo e identifica pattern
  const bodyText = document.body.textContent;
  const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  let id = 1;
  
  for (let i = 0; i < lines.length - 5; i++) {
    const line = lines[i];
    
    // Cerca pattern data: formato dd/mm
    const dateMatch = line.match(/^(\d{1,2})\/(\d{1,2})$/);
    
    if (dateMatch) {
      const [_, day, month] = dateMatch;
      const year = new Date().getFullYear();
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      
      // Prendi le prossime linee
      const nextLines = lines.slice(i + 1, i + 10);
      
      let dayOfWeek = nextLines[0] || '';
      let time = '09:00';
      let title = '';
      let location = '';
      let description = '';
      let distances = [];
      
      // Cerca l'orario nelle prossime linee
      for (let j = 0; j < nextLines.length; j++) {
        const l = nextLines[j];
        
        // Orario (hh:mm)
        if (/^\d{1,2}:\d{2}$/.test(l) && !time) {
          time = l;
        }
        // Titolo (prima stringa lunga che non è un orario)
        else if (l.length > 10 && !title && !l.includes('Aggiungi') && !l.includes('Google')) {
          title = l;
        }
        // Località (dopo il titolo)
        else if (title && l.length > 3 && !location && !l.includes('png') && !l.includes('Maps')) {
          location = l;
        }
        // Distanze (pattern: numeri separati da - o ,)
        if (/^[\d\s,\-\.]+$/.test(l) && l.length > 1) {
          const dists = l.split(/[-,\s]/)
            .map(d => parseFloat(d.trim()))
            .filter(d => !isNaN(d) && d > 0 && d < 200);
          if (dists.length > 0 && distances.length === 0) {
            distances = dists;
          }
        }
        
        // Costruisci descrizione
        if (j > 0 && l.length > 5 && !l.includes('png')) {
          description += l + ' ';
        }
      }
      
      // Tipo di gara
      let type = 'Corsa su strada';
      const descLower = (title + ' ' + description).toLowerCase();
      if (descLower.includes('trail')) type = 'Trail';
      else if (descLower.includes('camminata')) type = 'Camminata';
      else if (descLower.includes('skyrace')) type = 'Skyrace';
      else if (descLower.includes('marathon') || descLower.includes('maratona')) type = 'Marathon';
      else if (descLower.includes('competitiv')) type = 'Competitiva';
      
      const isCompetitive = descLower.includes('competitiv') || descLower.includes('grand prix');
      
      // Prezzo
      let price = 'Da definire';
      const priceMatch = description.match(/(\d+)\s*€/);
      if (priceMatch) price = `${priceMatch[1]}€`;
      else if (descLower.includes('gratuito') || descLower.includes('gratis')) price = 'Gratuito';
      
      // Aggiungi solo se abbiamo dati minimi
      if (title && location && distances.length > 0) {
        races.push({
          id: id++,
          date,
          time,
          title: title.replace(/\d+°|\d+ª|\d+\^/g, '').trim(),
          location: location.split(',')[0].trim(),
          venue: location,
          distances,
          description: description.trim().substring(0, 300),
          type,
          isCompetitive,
          hasMap: true,
          hasAttachment: true,
          price
        });
      }
      
      // Salta le linee già processate
      i += 10;
    }
  }
  
  return races;
}
