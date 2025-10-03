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
    
    // DEBUG MODE
    if (req.query.debug === 'true') {
      const dom = new JSDOM(html);
      const document = dom.window.document;
      
      const tables = document.querySelectorAll('table');
      const rows = document.querySelectorAll('tr');
      
      const sampleRows = Array.from(rows).slice(0, 10).map(row => ({
        cellCount: row.querySelectorAll('td').length,
        firstCellText: row.querySelector('td')?.textContent.trim().substring(0, 50),
        innerHTML: row.innerHTML.substring(0, 300)
      }));
      
      return res.status(200).json({
        debug: true,
        htmlLength: html.length,
        tableCount: tables.length,
        rowCount: rows.length,
        sampleRows
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
  
  // Trova tutte le righe della tabella
  const allRows = Array.from(document.querySelectorAll('tr'));
  
  console.log(`Total rows found: ${allRows.length}`);
  
  let id = 1;
  
  for (let i = 0; i < allRows.length; i++) {
    try {
      const row = allRows[i];
      const cells = Array.from(row.querySelectorAll('td'));
      
      // Deve avere almeno 4 celle (data, ora, provincia, dettagli)
      if (cells.length < 4) continue;
      
      // La prima cella contiene la data in <b>
      const dateElement = cells[0].querySelector('b');
      if (!dateElement) continue;
      
      const dateText = dateElement.textContent.trim();
      const dateMatch = dateText.match(/^(\d{1,2})\/(\d{1,2})$/);
      
      if (!dateMatch) continue;
      
      const [_, day, month] = dateMatch;
      const year = new Date().getFullYear();
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      
      // Prima cella: contiene anche il giorno della settimana in <i> e provincia
      const firstCellText = cells[0].textContent;
      
      // Seconda cella: orario
      const timeText = cells[1]?.textContent.trim() || '09:00';
      
      // Terza cella: codice provincia (già nella prima cella, ma verifichiamo)
      let provinceCode = 'XY';
      const provinceMatch = firstCellText.match(/\n([A-Z]{2})\n/);
      if (provinceMatch) {
        provinceCode = provinceMatch[1];
      }
      
      // Quarta cella: titolo (spesso in <b>)
      const titleElement = cells[3]?.querySelector('b') || cells[3];
      const titleText = titleElement?.textContent.trim() || '';
      
      if (!titleText || titleText.length < 3) continue;
      
      // Cerca dettagli nelle celle successive o nella stessa riga
      let venueText = '';
      let description = '';
      
      // Spesso il venue è nella cella 3 o 4 (dopo il titolo)
      for (let j = 3; j < cells.length; j++) {
        const cellText = cells[j].textContent.trim();
        if (cellText && cellText.length > 10 && cellText !== titleText) {
          if (!venueText) {
            venueText = cellText;
          }
          description += ' ' + cellText;
        }
      }
      
      // Cerca anche nella riga successiva per più dettagli
      if (i + 1 < allRows.length) {
        const nextRow = allRows[i + 1];
        const nextCells = nextRow.querySelectorAll('td');
        
        for (let cell of nextCells) {
          const text = cell.textContent.trim();
          if (text && text.length > 10 && !text.includes('png') && !/^\d{1,2}\/\d{1,2}$/.test(text)) {
            description += ' ' + text;
          }
        }
      }
      
      description = description.trim();
      
      // Estrai distanze
      const distances = extractDistances(titleText + ' ' + description);
      if (distances.length === 0) continue;
      
      // Estrai località
      let location = extractLocation(venueText || titleText);
      
      // Nome provincia completo
      let provinceName = 'Fuori Provincia';
      if (provinceCode === 'MO') provinceName = 'Modena';
      else if (provinceCode === 'RE') provinceName = 'Reggio Emilia';
      else if (provinceCode === 'BO') provinceName = 'Bologna';
      else if (provinceCode === 'PR') provinceName = 'Parma';
      
      // Tipo di gara
      let type = 'Corsa su strada';
      const descLower = (titleText + ' ' + description).toLowerCase();
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
      else if (descLower.includes('gratuito') || descLower.includes('gratis') || descLower.includes('libera')) price = 'Gratuito';
      
      // Organizzatore
      let organizer = null;
      const organizerMatch = description.match(/(?:Organizzatore|organizzatore):\s*([^-\n]+)/i);
      if (organizerMatch) organizer = organizerMatch[1].trim();
      
      // Società
      let society = null;
      const societyMatch = description.match(/Societ[àa] o gruppo sportivo:\s*([^\n]+)/i);
      if (societyMatch) society = societyMatch[1].trim();
      
      // Email
      let emailAddress = null;
      const emailMatch = description.match(/[\w\.-]+@[\w\.-]+\.\w+/);
      if (emailMatch) emailAddress = emailMatch[0];
      
      // Telefono formattato
      let phoneNumber = null;
      const phoneMatch = description.match(/(\d{3})[\s\-]?(\d{3,4})[\s\-]?(\d{4})/);
      if (phoneMatch) {
        phoneNumber = `${phoneMatch[1]} ${phoneMatch[2]}${phoneMatch[3]}`;
      }
      
      // Estrai allegati dalla riga
      const attachments = extractAttachments(row, venueText, emailAddress);
      
      races.push({
        id: id++,
        date,
        time: timeText,
        title: titleText,
        location,
        province: provinceName,
        provinceCode,
        venue: venueText || location,
        distances: [...new Set(distances)].sort((a, b) => a - b),
        description: description.substring(0, 500).trim(),
        type,
        isCompetitive,
        price,
        organizer,
        society,
        phoneNumber,
        attachments
      });
      
    } catch (error) {
      console.error('Error parsing row:', error);
      continue;
    }
  }
  
  console.log(`Parsed ${races.length} races`);
  return races;
}

function extractDistances(text) {
  const distances = [];
  
  // Cerca pattern come "1.5 km", "10km", "5-10-21", "1,5-7,2-11"
  const patterns = [
    /(\d+[,.]?\d*)\s*km/gi,
    /(\d+[,.]?\d*)\s*[-–]\s*(\d+[,.]?\d*)\s*[-–]\s*(\d+[,.]?\d*)/g,
    /(\d+[,.]?\d*)\s*[-–]\s*(\d+[,.]?\d*)/g
  ];
  
  for (let pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      for (let i = 1; i < match.length; i++) {
        if (match[i]) {
          const num = parseFloat(match[i].replace(',', '.'));
          if (!isNaN(num) && num > 0 && num < 200) {
            distances.push(num);
          }
        }
      }
    }
  }
  
  return [...new Set(distances)];
}

function extractLocation(venue) {
  if (!venue) return 'N/D';
  
  // Prendi l'ultima parte dopo la virgola
  const parts = venue.split(',');
  if (parts.length > 1) {
    const lastPart = parts[parts.length - 1].trim();
    if (lastPart.length < 50) return lastPart;
  }
  
  // Fallback
  const words = venue.split(' ').slice(0, 3).join(' ');
  return words.length > 50 ? venue.substring(0, 50) : words;
}

function extractAttachments(row, venue, emailAddress) {
  const attachments = {
    hasCalendar: true,
    hasMaps: false,
    hasAttachment1: false,
    hasAttachment2: false,
    hasGPX: false,
    hasEmail: false,
    hasWebsite: false,
    hasRegistration: false,
    mapLink: null,
    emailAddress: null,
    websiteUrl: null,
    registrationUrl: null,
    attachmentUrls: []
  };
  
  // Cerca nella riga corrente
  const images = row.querySelectorAll('img');
  const links = row.querySelectorAll('a');
  
  // Analizza immagini
  for (let img of images) {
    const src = (img.src || img.getAttribute('src') || '').toLowerCase();
    const alt = (img.alt || '').toLowerCase();
    
    // Trova il link parent
    const parentLink = img.closest('a');
    const linkHref = parentLink?.href || parentLink?.getAttribute('href') || '';
    
    // Calendar (già presente nel nostro sistema)
    if (src.includes('calendar')) {
      attachments.hasCalendar = true;
    }
    
    // Maps
    if (src.includes('maps') || src.includes('mappa')) {
      attachments.hasMaps = true;
      if (venue) {
        attachments.mapLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue)}`;
      }
    }
    
    // Email
    if (src.includes('email') || src.includes('mail')) {
      attachments.hasEmail = true;
      if (emailAddress) {
        attachments.emailAddress = emailAddress;
      }
    }
    
    // Website
    if (src.includes('www') || src.includes('web')) {
      attachments.hasWebsite = true;
      if (linkHref && linkHref.startsWith('http')) {
        attachments.websiteUrl = linkHref;
      }
    }
    
    // Iscrizione
    if (src.includes('iscrizione') || alt.includes('iscrizione')) {
      attachments.hasRegistration = true;
      if (linkHref && linkHref.startsWith('http')) {
        attachments.registrationUrl = linkHref;
      }
    }
    
    // GPX
    if (src.includes('gpx') || alt.includes('gpx')) {
      attachments.hasGPX = true;
      if (linkHref) {
        const fullUrl = linkHref.startsWith('http') 
          ? linkHref 
          : `https://www.reggiocorre.it/${linkHref.replace(/^\//, '')}`;
        attachments.attachmentUrls.push(fullUrl);
      }
    }
    
    // Allegati (PDF, immagini)
    if (src.includes('allegato1') || src.includes('locandina')) {
      attachments.hasAttachment1 = true;
      if (linkHref) {
        const fullUrl = linkHref.startsWith('http') 
          ? linkHref 
          : `https://www.reggiocorre.it/${linkHref.replace(/^\//, '')}`;
        attachments.attachmentUrls.push(fullUrl);
      }
    }
    
    if (src.includes('allegato2') || src.includes('regolamento')) {
      attachments.hasAttachment2 = true;
      if (linkHref) {
        const fullUrl = linkHref.startsWith('http') 
          ? linkHref 
          : `https://www.reggiocorre.it/${linkHref.replace(/^\//, '')}`;
        attachments.attachmentUrls.push(fullUrl);
      }
    }
  }
  
  // Analizza link diretti
  for (let link of links) {
    const href = link.href || link.getAttribute('href') || '';
    const text = link.textContent.toLowerCase();
    
    if (!href) continue;
    
    // Link iscrizione
    if (text.includes('iscri') || href.includes('endu.net') || href.includes('iscrizione')) {
      attachments.hasRegistration = true;
      if (href.startsWith('http') && !attachments.registrationUrl) {
        attachments.registrationUrl = href;
      }
    }
    
    // Sito web
    if ((text.includes('sito') || text.includes('www')) && href.startsWith('http')) {
      attachments.hasWebsite = true;
      if (!attachments.websiteUrl) {
        attachments.websiteUrl = href;
      }
    }
    
    // File scaricabili
    if (href.includes('.pdf') || href.includes('.gpx') || href.includes('.jpg') || href.includes('.png')) {
      const fullUrl = href.startsWith('http') 
        ? href 
        : `https://www.reggiocorre.it/${href.replace(/^\//, '')}`;
      
      if (!attachments.attachmentUrls.includes(fullUrl)) {
        attachments.attachmentUrls.push(fullUrl);
      }
      
      if (href.includes('.gpx')) {
        attachments.hasGPX = true;
      }
    }
  }
  
  // Deduplica
  attachments.attachmentUrls = [...new Set(attachments.attachmentUrls)];
  
  return attachments;
}
