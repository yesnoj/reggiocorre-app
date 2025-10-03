// api/scraper.js - Vercel Serverless Function (FIXED)
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

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
  
  const allRows = Array.from(document.querySelectorAll('tr'));
  console.log(`Total rows found: ${allRows.length}`);
  
  let id = 1;
  
  for (let i = 0; i < allRows.length; i++) {
    try {
      const row = allRows[i];
      const cells = Array.from(row.querySelectorAll('td'));
      
      if (cells.length < 4) continue;
      
      // CELLA 0: Data in <b>
      const dateElement = cells[0].querySelector('b');
      if (!dateElement) continue;
      
      const dateText = dateElement.textContent.trim();
      const dateMatch = dateText.match(/^(\d{1,2})\/(\d{1,2})$/);
      if (!dateMatch) continue;
      
      const [_, day, month] = dateMatch;
      const year = new Date().getFullYear();
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      
      // CELLA 0: Estrai provincia
      const firstCellText = cells[0].textContent;
      let provinceCode = 'XY';
      const provinceMatch = firstCellText.match(/\b([A-Z]{2})\b/);
      if (provinceMatch) {
        provinceCode = provinceMatch[1];
      }
      
      // CELLA 1: Orario
      const timeText = cells[1]?.textContent.trim() || '09:00';
      
      // CELLA 3: Titolo principale (spesso in <b>)
      const titleElement = cells[3]?.querySelector('b') || cells[3];
      let titleText = titleElement?.textContent.trim() || '';
      
      if (!titleText || titleText.length < 3) continue;
      
      // IMPORTANTE: Il titolo potrebbe essere le distanze (es: "68 - 43 - 28")
      // In questo caso, cerca il vero titolo nelle celle successive
      const titleIsDistance = /^\d+[\s\-,]+\d+/.test(titleText);
      let realTitle = titleText;
      let venueText = '';
      let fullDescription = '';
      
      if (titleIsDistance) {
        // Il vero titolo è nella cella successiva o nel testo seguente
        for (let j = 4; j < cells.length; j++) {
          const cellText = cells[j].textContent.trim();
          const cellBold = cells[j].querySelector('b')?.textContent.trim();
          
          // Il vero titolo è spesso quello più lungo e in grassetto
          if (cellBold && cellBold.length > 10 && !cellBold.match(/^\d/)) {
            realTitle = cellBold;
            break;
          } else if (cellText.length > 15 && !cellText.match(/^\d/) && !venueText) {
            // Questo potrebbe essere il venue
            venueText = cellText;
          }
        }
      }
      
      // Cerca venue e descrizione completa nelle celle successive
      for (let j = 3; j < cells.length; j++) {
        const cellText = cells[j].textContent.trim();
        
        // Salta celle che sono solo numeri o immagini
        if (!cellText || cellText.length < 5 || /^[\d\s\-,\.]+$/.test(cellText)) continue;
        
        // Il venue spesso contiene "Via", indirizzo, o nome località
        if (!venueText && (cellText.includes('Via') || cellText.includes('Piazza') || 
            cellText.includes('Corso') || cellText.includes(',') && cellText.length > 20)) {
          venueText = cellText;
        }
        
        // Accumula descrizione (escludi il titolo)
        if (cellText !== realTitle && cellText !== titleText) {
          fullDescription += ' ' + cellText;
        }
      }
      
      // Pulisci descrizione da artefatti
      fullDescription = fullDescription
        .replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/png\/\w+\.png/gi, '')
        .trim();
      
      // Estrai località dal venue (ultima parte dopo virgola)
      let location = 'N/D';
      if (venueText) {
        const venueParts = venueText.split(',');
        if (venueParts.length > 0) {
          const lastPart = venueParts[venueParts.length - 1].trim();
          // Se l'ultima parte è corta e sensata, usala come location
          if (lastPart && lastPart.length > 2 && lastPart.length < 30 && !/^\d/.test(lastPart)) {
            location = lastPart;
          } else if (venueParts.length > 1) {
            // Altrimenti prova la penultima parte
            location = venueParts[venueParts.length - 2].trim();
          }
        }
      }
      
      // Se location non trovata, cerca nel titolo o descrizione
      if (location === 'N/D') {
        const locationMatch = (realTitle + ' ' + fullDescription).match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\b/);
        if (locationMatch) {
          location = locationMatch[1];
        }
      }
      
      // Estrai distanze (sia dal titolo originale che dalla descrizione)
      const distances = extractDistances(titleText + ' ' + realTitle + ' ' + fullDescription);
      if (distances.length === 0) continue;
      
      // Nome provincia
      let provinceName = 'Fuori Provincia';
      if (provinceCode === 'MO') provinceName = 'Modena';
      else if (provinceCode === 'RE') provinceName = 'Reggio Emilia';
      else if (provinceCode === 'BO') provinceName = 'Bologna';
      else if (provinceCode === 'PR') provinceName = 'Parma';
      
      // Tipo di gara
      let type = 'Corsa su strada';
      const descLower = (realTitle + ' ' + fullDescription).toLowerCase();
      if (descLower.includes('trail')) type = 'Trail';
      else if (descLower.includes('camminata')) type = 'Camminata';
      else if (descLower.includes('skyrace')) type = 'Skyrace';
      else if (descLower.includes('marathon') || descLower.includes('maratona')) type = 'Marathon';
      else if (descLower.includes('competitiv')) type = 'Competitiva';
      
      const isCompetitive = descLower.includes('competitiv') || descLower.includes('grand prix');
      
      // Prezzo
      let price = 'Da definire';
      const priceMatch = fullDescription.match(/(\d+)\s*€/);
      if (priceMatch) price = `${priceMatch[1]}€`;
      else if (descLower.includes('gratuito') || descLower.includes('gratis') || descLower.includes('libera')) {
        price = 'Gratuito';
      }
      
      // Organizzatore
      let organizer = null;
      const organizerMatch = fullDescription.match(/(?:Organizzatore|organizzatore):\s*([^\-\n]+?)(?:\s*\-|\n|$)/i);
      if (organizerMatch) organizer = organizerMatch[1].trim();
      
      // Società
      let society = null;
      const societyMatch = fullDescription.match(/Societ[àa] o gruppo sportivo:\s*([^\n]+?)(?:Organizzatore|$)/i);
      if (societyMatch) society = societyMatch[1].trim();
      
      // Email
      let emailAddress = null;
      const emailMatch = fullDescription.match(/[\w\.-]+@[\w\.-]+\.\w+/);
      if (emailMatch) emailAddress = emailMatch[0];
      
      // Telefono
      let phoneNumber = null;
      const phoneMatch = fullDescription.match(/(\d{3})[\s\-]?(\d{3,4})[\s\-]?(\d{4})/);
      if (phoneMatch) {
        phoneNumber = `${phoneMatch[1]} ${phoneMatch[2]}${phoneMatch[3]}`;
      }
      
      // Estrai allegati
      const attachments = extractAttachments(row, venueText, emailAddress);
      
      races.push({
        id: id++,
        date,
        time: timeText,
        title: realTitle,
        location,
        province: provinceName,
        provinceCode,
        venue: venueText || location,
        distances: [...new Set(distances)].sort((a, b) => a - b),
        description: fullDescription.substring(0, 500).trim(),
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
  
  const images = row.querySelectorAll('img');
  const links = row.querySelectorAll('a');
  
  for (let img of images) {
    const src = (img.src || img.getAttribute('src') || '').toLowerCase();
    const alt = (img.alt || '').toLowerCase();
    
    const parentLink = img.closest('a');
    const linkHref = parentLink?.href || parentLink?.getAttribute('href') || '';
    
    if (src.includes('calendar')) attachments.hasCalendar = true;
    
    if (src.includes('maps') || src.includes('mappa')) {
      attachments.hasMaps = true;
      if (venue) {
        attachments.mapLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue)}`;
      }
    }
    
    if (src.includes('email') || src.includes('mail')) {
      attachments.hasEmail = true;
      if (emailAddress) attachments.emailAddress = emailAddress;
    }
    
    if (src.includes('www') || src.includes('web')) {
      attachments.hasWebsite = true;
      if (linkHref && linkHref.startsWith('http')) {
        attachments.websiteUrl = linkHref;
      }
    }
    
    if (src.includes('iscrizione') || alt.includes('iscrizione')) {
      attachments.hasRegistration = true;
      if (linkHref && linkHref.startsWith('http')) {
        attachments.registrationUrl = linkHref;
      }
    }
    
    if (src.includes('gpx') || alt.includes('gpx')) {
      attachments.hasGPX = true;
      if (linkHref) {
        const fullUrl = linkHref.startsWith('http') 
          ? linkHref 
          : `https://www.reggiocorre.it/${linkHref.replace(/^\//, '')}`;
        attachments.attachmentUrls.push(fullUrl);
      }
    }
    
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
  
  for (let link of links) {
    const href = link.href || link.getAttribute('href') || '';
    const text = link.textContent.toLowerCase();
    
    if (!href) continue;
    
    if (text.includes('iscri') || href.includes('endu.net') || href.includes('iscrizione')) {
      attachments.hasRegistration = true;
      if (href.startsWith('http') && !attachments.registrationUrl) {
        attachments.registrationUrl = href;
      }
    }
    
    if ((text.includes('sito') || text.includes('www')) && href.startsWith('http')) {
      attachments.hasWebsite = true;
      if (!attachments.websiteUrl) {
        attachments.websiteUrl = href;
      }
    }
    
    if (href.includes('.pdf') || href.includes('.gpx') || href.includes('.jpg') || href.includes('.png')) {
      const fullUrl = href.startsWith('http') 
        ? href 
        : `https://www.reggiocorre.it/${href.replace(/^\//, '')}`;
      
      if (!attachments.attachmentUrls.includes(fullUrl)) {
        attachments.attachmentUrls.push(fullUrl);
      }
      
      if (href.includes('.gpx')) attachments.hasGPX = true;
    }
  }
  
  attachments.attachmentUrls = [...new Set(attachments.attachmentUrls)];
  
  return attachments;
}
