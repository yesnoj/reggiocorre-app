// api/scraper.js - Vercel Serverless Function
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

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
        rowCount: document.querySelectorAll('tr').length,
        linkCount: document.querySelectorAll('a').length,
        imageCount: document.querySelectorAll('img').length
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
  
  // Estrai tutto il testo dal body e analizzalo
  const bodyText = document.body.textContent;
  const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  let id = 1;
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    
    // Cerca pattern data: formato dd/mm
    const dateMatch = line.match(/^(\d{1,2})\/(\d{1,2})$/);
    
    if (dateMatch) {
      const [_, day, month] = dateMatch;
      const year = new Date().getFullYear();
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      
      // Struttura trovata nel debug:
      // i     -> data (es. "4/10")
      // i+1   -> giorno settimana (es. "sab")
      // i+2   -> provincia (es. "RE", "MO", "XY")
      // i+3   -> orario (es. "20:30")
      // i+4   -> titolo gara
      // i+5   -> venue/indirizzo
      // i+6+  -> descrizione e distanze
      
      i++; // Salta al giorno
      const dayOfWeek = lines[i] || '';
      
      i++; // Salta alla provincia
      const provinceCode = lines[i] || 'XY';
      
      i++; // Salta all'orario
      const time = lines[i] || '09:00';
      
      i++; // Salta al titolo
      const title = lines[i] || '';
      
      i++; // Salta al venue
      const venue = lines[i] || '';
      
      // Converti codice provincia in nome completo
      let provinceName = 'Fuori Provincia';
      if (provinceCode === 'MO') provinceName = 'Modena';
      else if (provinceCode === 'RE') provinceName = 'Reggio Emilia';
      else if (provinceCode === 'BO') provinceName = 'Bologna';
      
      // Estrai località dal venue
      let location = venue;
      if (venue.includes(',')) {
        const parts = venue.split(',');
        location = parts[parts.length - 1].trim();
      }
      
      // Pulisci location
      if (location.length > 50) {
        location = location.split(' ').slice(0, 3).join(' ');
      }
      
      // Cerca descrizione e distanze nelle linee successive
      i++;
      let description = '';
      let distances = [];
      let foundDistances = false;
      
      // Leggi le prossime 20 righe o fino alla prossima data
      for (let j = 0; j < 20 && i < lines.length; j++, i++) {
        const l = lines[i];
        
        // Se troviamo una nuova data, fermiamoci e torna indietro di 1
        if (/^\d{1,2}\/(\d{1,2})$/.test(l)) {
          i--; // Torna indietro per processare questa data al prossimo ciclo
          break;
        }
        
        // Cerca distanze (numeri separati da trattini o virgole+trattini)
        // Es: "68 - 43 - 28" o "1,5-7,2-11" o "2,5- 6,5-12- 21" o "12-19-29"
        if (/^[\d\s,\-\.]+$/.test(l) && l.length < 40 && !foundDistances) {
          // Rimuovi spazi e splitta sui trattini
          const parts = l.replace(/\s+/g, '').split('-');
          const dists = parts
            .map(p => parseFloat(p.replace(',', '.')))
            .filter(d => !isNaN(d) && d > 0 && d < 200);
          
          if (dists.length > 0) {
            distances = dists;
            foundDistances = true;
            continue;
          }
        }
        
        // Aggiungi alla descrizione (escludi linee vuote, con "png", link, ecc)
        if (l.length > 3 && 
            !l.includes('png') && 
            !l.includes('http') &&
            !l.includes('Aggiungi') &&
            !l.includes('Google Maps')) {
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
      
      // Estrai organizzatore
      let organizer = null;
      const organizerMatch = description.match(/Organizzatore:\s*([^-\n]+)/i);
      if (organizerMatch) {
        organizer = organizerMatch[1].trim();
      }
      
      // Estrai società
      let society = null;
      const societyMatch = description.match(/Societ[àa] o gruppo sportivo:\s*([^\n]+)/i);
      if (societyMatch) {
        society = societyMatch[1].trim();
      }
      
      // Estrai email
      let emailAddress = null;
      const emailMatch = description.match(/[\w\.-]+@[\w\.-]+\.\w+/);
      if (emailMatch) {
        emailAddress = emailMatch[0];
      }
      
      // Estrai telefono
      let phoneNumber = null;
      const phoneMatch = description.match(/(\d{3}[\s\-]?\d{3}[\s\-]?\d{4}|\d{10})/);
      if (phoneMatch) {
        phoneNumber = phoneMatch[0].replace(/\s|-/g, '');
      }
      
      // Crea oggetto attachments
      const attachments = {
        hasCalendar: true,
        hasMaps: true,
        hasAttachment1: description.includes('volant') || description.includes('locand'),
        hasAttachment2: false,
        hasGPX: description.toLowerCase().includes('gpx'),
        hasEmail: emailAddress !== null,
        hasWebsite: description.toLowerCase().includes('www') || description.toLowerCase().includes('http'),
        hasRegistration: description.toLowerCase().includes('iscri'),
        mapLink: venue ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue)}` : null,
        emailAddress,
        websiteUrl: null,
        registrationUrl: null,
        attachmentUrls: []
      };
      
      // Aggiungi solo se abbiamo dati minimi
      if (title && title.length > 3 && location && distances.length > 0) {
        races.push({
          id: id++,
          date,
          time: time && /^\d{1,2}:\d{2}$/.test(time) ? time : '09:00',
          title: title.replace(/\d+°|\d+ª|\d+\^/g, '').trim(),
          location: location.trim(),
          province: provinceName,
          provinceCode: provinceCode,
          venue: venue.trim(),
          distances: [...new Set(distances)].sort((a, b) => a - b),
          description: description.trim().substring(0, 400),
          type,
          isCompetitive,
          price,
          organizer,
          society,
          phoneNumber,
          attachments
        });
      }
    } else {
      i++;
    }
  }
  
  return races;
}