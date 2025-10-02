// api/scraper.js - Vercel Serverless Function
// Questo file va nella cartella api/ del progetto

import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';

export default async function handler(req, res) {
  // Abilita CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

  try {
    console.log('Fetching data from ReggioCorre...');
    
    const response = await fetch('https://www.reggiocorre.it/calendario.aspx');
    const html = await response.text();
    
    console.log('Parsing HTML...');
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
      lastUpdate: new Date().toISOString(),
      races: filteredRaces
    });
    
  } catch (error) {
    console.error('Error scraping:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      races: []
    });
  }
}

function parseReggioCorre(html) {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const races = [];
  
  // Cerca tutte le righe della tabella calendario
  const rows = document.querySelectorAll('tr');
  
  let currentDate = null;
  let id = 1;
  
  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    
    if (cells.length < 3) return;
    
    // Prima cella: controlla se contiene una data (formato: gg/mm)
    const firstCell = cells[0].textContent.trim();
    const dateMatch = firstCell.match(/^(\d{1,2})\/(\d{1,2})$/);
    
    if (dateMatch) {
      const [_, day, month] = dateMatch;
      const year = new Date().getFullYear();
      currentDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      
      // Estrai dati dalla riga
      let title = '';
      let location = '';
      let time = '09:00';
      let description = '';
      let distances = [];
      
      // Cerca nelle celle successive
      for (let i = 1; i < cells.length; i++) {
        const cellText = cells[i].textContent.trim();
        
        // Riconosci l'orario (formato hh:mm)
        if (/^\d{1,2}:\d{2}$/.test(cellText)) {
          time = cellText;
        }
        // Titolo della gara (di solito la cella più lunga con testo)
        else if (cellText.length > 10 && !title && !cellText.includes('png') && !cellText.includes('http')) {
          title = cellText;
        }
        // Località (dopo il titolo)
        else if (title && cellText.length > 3 && !location && !cellText.includes('png')) {
          location = cellText.split(',')[0].trim();
        }
        // Distanze (numeri con trattini o virgole)
        else if (/[\d\s,\-\.]+km/i.test(cellText) || /^[\d\s,\-\.]+$/.test(cellText)) {
          const distStr = cellText.replace(/km/gi, '');
          const dists = distStr.split(/[-,]/)
            .map(d => parseFloat(d.trim()))
            .filter(d => !isNaN(d) && d > 0 && d < 200);
          if (dists.length > 0) distances = dists;
        }
      }
      
      // Concatena tutto il testo della riga come descrizione
      description = Array.from(cells)
        .map(c => c.textContent.trim())
        .filter(t => t && !t.includes('png') && t.length > 2)
        .join(' ')
        .substring(0, 300);
      
      // Determina il tipo di gara
      let type = 'Corsa su strada';
      const descLower = (title + ' ' + description).toLowerCase();
      if (descLower.includes('trail')) type = 'Trail';
      else if (descLower.includes('camminata')) type = 'Camminata';
      else if (descLower.includes('skyrace')) type = 'Skyrace';
      else if (descLower.includes('marathon') || descLower.includes('maratona')) type = 'Marathon';
      else if (descLower.includes('competitiv')) type = 'Competitiva';
      
      const isCompetitive = descLower.includes('competitiv') || descLower.includes('grand prix');
      
      // Estrai prezzo
      let price = 'Da definire';
      const priceMatch = description.match(/(\d+)\s*€/);
      if (priceMatch) price = `${priceMatch[1]}€`;
      else if (descLower.includes('gratuito') || descLower.includes('gratis')) price = 'Gratuito';
      
      // Aggiungi solo se abbiamo dati significativi
      if (currentDate && title && location && distances.length > 0) {
        races.push({
          id: id++,
          date: currentDate,
          time,
          title: title.replace(/\d+°|\d+ª|\d+^/g, '').trim(),
          location,
          venue: location,
          distances,
          description: description.trim(),
          type,
          isCompetitive,
          hasMap: true,
          hasAttachment: true,
          price
        });
      }
    }
  });
  
  return races;
}
