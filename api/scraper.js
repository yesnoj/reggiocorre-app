// api/scraper.js - Vercel Serverless Function con estrazione completa allegati
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
    
    // DEBUG MODE
    if (req.query.debug === 'true') {
      const dom = new JSDOM(html);
      const document = dom.window.document;
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
  
  // Cerca tutte le righe della tabella
  const rows = document.querySelectorAll('tr');
  
  let id = 1;
  
  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    
    if (cells.length < 5) return;
    
    // Prima cella: data (formato: dd/mm)
    const firstCellText = cells[0].textContent.trim();
    const dateMatch = firstCellText.match(/^(\d{1,2})\/(\d{1,2})$/);
    
    if (!dateMatch) return;
    
    const [_, day, month] = dateMatch;
    const year = new Date().getFullYear();
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    
    // Seconda cella: giorno della settimana
    const dayOfWeek = cells[1] ? cells[1].textContent.trim() : '';
    
    // Cerca nelle celle successive i vari elementi
    let province = 'XY';
    let time = '09:00';
    let title = '';
    let venue = '';
    let description = '';
    let distances = [];
    
    // Links e allegati
    const links = {
      attachments: [],  // PDF allegati (allegato1, allegato2, etc)
      website: null,     // Sito web evento
      email: null,       // Email contatto
      registration: null, // Link iscrizione online
      gpx: null,         // Traccia GPX
      maps: null,        // Google Maps (già gestito)
      calendar: null     // iCal (già gestito)
    };
    
    // Analizza ogni cella per estrarre dati e link
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const cellText = cell.textContent.trim();
      
      // Provincia (MO, RE, BO, XY)
      if (/^(MO|RE|BO|XY)$/.test(cellText)) {
        province = cellText;
      }
      
      // Orario (hh:mm)
      if (/^\d{1,2}:\d{2}$/.test(cellText) && !time) {
        time = cellText;
      }
      
      // Cerca link all'interno della cella
      const linkElements = cell.querySelectorAll('a');
      linkElements.forEach(link => {
        const href = link.getAttribute('href');
        const imgElements = link.querySelectorAll('img');
        
        if (href && imgElements.length > 0) {
          const imgSrc = imgElements[0].getAttribute('src') || '';
          
          // Identifica il tipo di link dall'immagine
          if (imgSrc.includes('allegato')) {
            // PDF allegati
            const fullUrl = href.startsWith('http') ? href : `https://www.reggiocorre.it/${href}`;
            links.attachments.push({
              type: 'pdf',
              url: fullUrl,
              label: link.getAttribute('title') || 'Locandina'
            });
          } else if (imgSrc.includes('www')) {
            // Sito web
            const fullUrl = href.startsWith('http') ? href : `https://www.reggiocorre.it/${href}`;
            links.website = fullUrl;
          } else if (imgSrc.includes('email')) {
            // Email
            if (href.startsWith('mailto:')) {
              links.email = href.replace('mailto:', '');
            } else {
              links.email = href;
            }
          } else if (imgSrc.includes('iscrizione')) {
            // Iscrizione online
            const fullUrl = href.startsWith('http') ? href : `https://www.reggiocorre.it/${href}`;
            links.registration = fullUrl;
          } else if (imgSrc.includes('gpx')) {
            // Traccia GPX
            const fullUrl = href.startsWith('http') ? href : `https://www.reggiocorre.it/${href}`;
            links.gpx = fullUrl;
          } else if (imgSrc.includes('maps')) {
            // Google Maps
            const fullUrl = href.startsWith('http') ? href : `https://www.reggiocorre.it/${href}`;
            links.maps = fullUrl;
          }
        }
      });
      
      // Estrai anche email dal testo (es: "info@podisticacorreggio.it")
      const emailMatch = cellText.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
      if (emailMatch && !links.email) {
        links.email = emailMatch[1];
      }
      
      // Estrai titolo (cella più lunga senza link/immagini)
      if (cellText.length > 10 && !title && linkElements.length === 0 && !cellText.includes('png') && !/^\d{1,2}:\d{2}$/.test(cellText) && !/^(MO|RE|BO|XY)$/.test(cellText)) {
        title = cellText;
      }
      
      // Venue (dopo il titolo, cella con indirizzo)
      if (title && cellText.length > 10 && !venue && cellText.includes(',') && linkElements.length === 0) {
        venue = cellText;
      }
      
      // Descrizione (accumula testo lungo)
      if (cellText.length > 20 && !cellText.includes('png') && cellText !== title && cellText !== venue) {
        description += cellText + ' ';
      }
      
      // Distanze
      if (/^[\d\s,\-\.]+$/.test(cellText) && cellText.length < 30) {
        const dists = cellText
          .replace(/\s+/g, '')
          .split('-')
          .map(d => parseFloat(d.replace(',', '.')))
          .filter(d => !isNaN(d) && d > 0 && d < 200);
        
        if (dists.length > 0 && distances.length === 0) {
          distances = dists;
        }
      }
    }
    
    // Converti codice provincia in nome
    let provinceName = 'Fuori Provincia';
    if (province === 'MO') provinceName = 'Modena';
    else if (province === 'RE') provinceName = 'Reggio Emilia';
    else if (province === 'BO') provinceName = 'Bologna';
    
    // Estrai località dal venue
    let location = venue;
    if (venue.includes(',')) {
      const parts = venue.split(',');
      location = parts[parts.length - 1].trim();
    }
    if (location.length > 50) {
      location = location.split(' ').slice(0, 3).join(' ');
    }
    
    // Determina tipo di gara
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
    
    // Estrai numero telefono
    let phone = null;
    const phoneMatch = description.match(/(\d{3}[\s-]?\d{3,4}[\s-]?\d{4})/);
    if (phoneMatch) phone = phoneMatch[1];
    
    // Estrai organizzatore
    let organizer = null;
    const organizerMatch = description.match(/Organizzatore:\s*([^-\n]+)/i);
    if (organizerMatch) organizer = organizerMatch[1].trim();
    
    // Aggiungi solo se abbiamo dati minimi
    if (title && title.length > 3 && location && location.length > 0 && distances && distances.length > 0) {
      races.push({
        id: id++,
        date,
        time: time && /^\d{1,2}:\d{2}$/.test(time) ? time : '09:00',
        title: title.replace(/\d+°|\d+ª|\d+\^/g, '').trim(),
        location: location.trim(),
        province: provinceName,
        provinceCode: province,
        venue: venue.trim(),
        distances,
        description: description.trim().substring(0, 500),
        type,
        isCompetitive,
        price,
        phone,
        organizer,
        links,  // NUOVO: tutti i link e allegati
        hasMap: !!links.maps,
        hasAttachment: links.attachments.length > 0,
        hasWebsite: !!links.website,
        hasEmail: !!links.email,
        hasRegistration: !!links.registration,
        hasGpx: !!links.gpx
      });
    }
  });
  
  return races;
}