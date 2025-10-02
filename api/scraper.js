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
  
  // Estrai tutto il testo e dividilo in linee
  const bodyText = document.body.textContent;
  const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  let id = 1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Cerca pattern data: formato dd/mm
    const dateMatch = line.match(/^(\d{1,2})\/(\d{1,2})$/);
    
    if (dateMatch) {
      const [_, day, month] = dateMatch;
      const year = new Date().getFullYear();
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      
      // La struttura è:
      // i     -> data (es. "4/10")
      // i+1   -> giorno settimana (es. "sab")
      // i+2   -> provincia (es. "RE", "MO", "XY")
      // i+3   -> orario (es. "20:30")
      // i+4   -> titolo gara
      // i+5   -> località/venue
      // i+6+  -> descrizione
      // ...   -> distanze (numero con trattini)
      
      const dayOfWeek = lines[i + 1] || '';
      const province = lines[i + 2] || '';
      const time = lines[i + 3] || '09:00';
      const title = lines[i + 4] || '';
      const venue = lines[i + 5] || '';
      
      // Estrai località dal venue (prendi l'ultima parte dopo la virgola)
      let location = venue;
      if (venue.includes(',')) {
        const parts = venue.split(',');
        location = parts[parts.length - 1].trim();
      }
      
      // Se location è ancora troppo lungo, prendi solo le prime parole
      if (location.length > 50) {
        location = location.split(' ').slice(0, 3).join(' ');
      }
      
      // Cerca descrizione e distanze nelle linee successive
      let description = '';
      let distances = [];
      let foundDistances = false;
      
      for (let j = i + 6; j < Math.min(i + 20, lines.length); j++) {
        const l = lines[j] || '';
        
        // Se troviamo una nuova data, fermiamoci
        if (/^\d{1,2}\/\d{1,2}$/.test(l)) break;
        
        // Cerca distanze (pattern: numeri con trattini)
        // Es: "68 - 43 - 28" o "1,5-7,2-11" o "2,5- 6,5-12- 21"
        // Il separatore principale è il TRATTINO, la virgola è per i decimali
        if (/^[\d\s,\-\.]+$/.test(l) && l.length < 30) {
          const dists = l
            .replace(/\s+/g, '') // rimuovi tutti gli spazi
            .split('-') // split SOLO sui trattini
            .map(d => parseFloat(d.replace(',', '.'))) // converti virgole decimali in punti
            .filter(d => !isNaN(d) && d > 0 && d < 200);
          
          if (dists.length > 0 && !foundDistances) {
            distances = dists;
            foundDistances = true;
            continue; // Non aggiungere alla descrizione
          }
        }
        
        // Aggiungi alla descrizione (escludi linee troppo corte o con "png")
        if (l.length > 5 && !l.includes('png') && !l.includes('http')) {
          description += l + ' ';
        }
      }
      
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
      else if (descLower.includes('gratuito') || descLower.includes('gratis') || descLower.includes('libera')) price = 'Gratuito';
      
      // Aggiungi solo se abbiamo dati minimi necessari
      if (title && title.length > 3 && location && location.length > 0 && distances && distances.length > 0) {
        races.push({
          id: id++,
          date,
          time: time && /^\d{1,2}:\d{2}$/.test(time) ? time : '09:00',
          title: title.replace(/\d+°|\d+ª|\d+\^/g, '').trim(),
          location: location.trim(),
          venue: venue.trim(),
          distances,
          description: description.trim().substring(0, 300),
          type,
          isCompetitive,
          hasMap: true,
          hasAttachment: true,
          price
        });
      }
    }
  }
  
  return races;
}
