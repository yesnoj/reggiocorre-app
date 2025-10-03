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
      
      // Analisi dettagliata della struttura
      const tables = document.querySelectorAll('table');
      const rows = document.querySelectorAll('tr');
      const yellowCells = document.querySelectorAll('td[bgcolor="#FFFF99"], td[style*="FFFF99"]');
      
      // Prendi alcune righe di esempio
      const sampleRows = Array.from(rows).slice(0, 10).map(row => ({
        cellCount: row.querySelectorAll('td').length,
        firstCellText: row.querySelector('td')?.textContent.trim().substring(0, 50),
        hasYellowCell: row.querySelector('td[bgcolor="#FFFF99"], td[style*="FFFF99"]') !== null,
        innerHTML: row.innerHTML.substring(0, 300)
      }));
      
      return res.status(200).json({
        debug: true,
        htmlLength: html.length,
        tableCount: tables.length,
        rowCount: rows.length,
        yellowCellCount: yellowCells.length,
        sampleRows,
        firstYellowCellContent: yellowCells[0]?.textContent.trim(),
        bodyPreview: document.body.textContent.substring(0, 1000)
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
  
  // Strategia multipla per trovare le righe con le date
  
  // 1. Cerca celle gialle con diverse sintassi
  const yellowCellSelectors = [
    'td[bgcolor="#FFFF99"]',
    'td[bgcolor="#ffff99"]',
    'td[style*="FFFF99"]',
    'td[style*="ffff99"]',
    'td[style*="background-color:#FFFF99"]',
    'td[style*="background-color: #FFFF99"]'
  ];
  
  let dateRows = [];
  for (let selector of yellowCellSelectors) {
    const cells = document.querySelectorAll(selector);
    for (let cell of cells) {
      const row = cell.closest('tr');
      if (row && !dateRows.includes(row)) {
        dateRows.push(row);
      }
    }
  }
  
  console.log(`Found ${dateRows.length} date rows with yellow cells`);
  
  // 2. Se non trova celle gialle, cerca righe con pattern data
  if (dateRows.length === 0) {
    const allRows = document.querySelectorAll('tr');
    for (let row of allRows) {
      const firstCell = row.querySelector('td');
      if (firstCell) {
        const text = firstCell.textContent.trim();
        if (/^\d{1,2}\/\d{1,2}$/.test(text)) {
          dateRows.push(row);
        }
      }
    }
    console.log(`Found ${dateRows.length} date rows by text pattern`);
  }
  
  // 3. Parsing delle righe trovate
  let id = 1;
  
  for (let row of dateRows) {
    try {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 3) continue;
      
      // Prima cella: data
      const dateText = cells[0]?.textContent.trim() || '';
      const dateMatch = dateText.match(/(\d{1,2})\/(\d{1,2})/);
      
      if (!dateMatch) continue;
      
      const [_, day, month] = dateMatch;
      const year = new Date().getFullYear();
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      
      // Analizza le celle successive
      let timeText = '09:00';
      let provinceCode = 'XY';
      let titleText = '';
      let venueText = '';
      let description = '';
      
      // Cerca orario nelle celle
      for (let i = 1; i < cells.length && i < 5; i++) {
        const text = cells[i].textContent.trim();
        if (/^\d{1,2}:\d{2}$/.test(text)) {
          timeText = text;
          break;
        }
      }
      
      // Cerca provincia (codice a 2 lettere maiuscole)
      for (let i = 1; i < cells.length && i < 5; i++) {
        const text = cells[i].textContent.trim();
        if (/^[A-Z]{2}$/.test(text)) {
          provinceCode = text;
          break;
        }
      }
      
      // Il titolo è spesso in grassetto o nella cella più lunga
      const boldElement = row.querySelector('b, strong');
      if (boldElement) {
        titleText = boldElement.textContent.trim();
      } else {
        // Fallback: cerca la cella con più testo (esclusa la prima)
        let maxLen = 0;
        for (let i = 1; i < cells.length; i++) {
          const text = cells[i].textContent.trim();
          if (text.length > maxLen && text.length > 10 && !/^\d{1,2}:\d{2}$/.test(text) && !/^[A-Z]{2}$/.test(text)) {
            titleText = text;
            maxLen = text.length;
          }
        }
      }
      
      // Cerca dettagli nelle righe successive
      let nextRow = row.nextElementSibling;
      let rowsChecked = 0;
      const maxRowsToCheck = 5;
      
      while (nextRow && rowsChecked < maxRowsToCheck) {
        const nextText = nextRow.textContent.trim();
        
        // Fermati se trovi un'altra data
        if (/^\d{1,2}\/\d{1,2}/.test(nextText.substring(0, 10))) {
          break;
        }
        
        // Salta righe con solo icone
        if (nextText.length > 10 && !nextText.includes('png') && !nextText.includes('jpg')) {
          if (!venueText && nextText.length > 15) {
            venueText = nextText;
          }
          description += ' ' + nextText;
        }
        
        nextRow = nextRow.nextElementSibling;
        rowsChecked++;
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
      else if (descLower.includes('gratuito') || descLower.includes('gratis')) price = 'Gratuito';
      
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
      
      // Estrai allegati
      const attachments = extractAttachments(row, venueText, emailAddress);
      
      // Titolo pulito (mantieni numeri di edizione)
      const cleanTitle = titleText.trim();
      
      if (cleanTitle && cleanTitle.length > 3 && location && distances.length > 0) {
        races.push({
          id: id++,
          date,
          time: timeText,
          title: cleanTitle,
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
      }
      
    } catch (error) {
      console.error('Error parsing row:', error);
      continue;
    }
  }
  
  return races;
}

function extractDistances(text) {
  const distances = [];
  
  // Pattern multipli per catturare vari formati
  const patterns = [
    /(\d+[,.]?\d*)\s*km/gi,
    /(\d+[,.]?\d*)\s*[-–]\s*(\d+[,.]?\d*)\s*[-–]\s*(\d+[,.]?\d*)/g,
    /(?:^|\s)(\d+[,.]?\d*)(?=\s*[-–km]|\s|$)/g
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
  
  // Prendi l'ultima parte dopo la virgola (di solito è la città)
  const parts = venue.split(',');
  if (parts.length > 1) {
    const lastPart = parts[parts.length - 1].trim();
    if (lastPart.length < 50) return lastPart;
  }
  
  // Fallback: prime 3 parole
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
  
  // Cerca immagini e link nella riga e nelle successive
  const images = row.querySelectorAll('img');
  const links = row.querySelectorAll('a');
  
  // Analizza anche la riga successiva (spesso contiene gli allegati)
  const nextRow = row.nextElementSibling;
  if (nextRow) {
    const nextImages = nextRow.querySelectorAll('img');
    const nextLinks = nextRow.querySelectorAll('a');
    
    for (let img of nextImages) {
      images.push ? images.push(img) : null;
    }
    for (let link of nextLinks) {
      links.push ? links.push(link) : null;
    }
  }
  
  // Analizza immagini
  for (let img of images) {
    const src = (img.src || img.getAttribute('src') || '').toLowerCase();
    const alt = (img.alt || '').toLowerCase();
    
    const parentLink = img.closest('a');
    const linkHref = parentLink?.href || parentLink?.getAttribute('href') || '';
    
    // Maps
    if (src.includes('maps') || src.includes('mappa')) {
      attachments.hasMaps = true;
      if (venue && !attachments.mapLink) {
        attachments.mapLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue)}`;
      }
    }
    
    // Email
    if (src.includes('email') || src.includes('mail')) {
      attachments.hasEmail = true;
      if (emailAddress) attachments.emailAddress = emailAddress;
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
        const fullUrl = linkHref.startsWith('http') ? linkHref : `https://www.reggiocorre.it/${linkHref.replace(/^\//, '')}`;
        attachments.attachmentUrls.push(fullUrl);
      }
    }
    
    // Allegati
    if (src.includes('allegato')) {
      if (src.includes('allegato1')) attachments.hasAttachment1 = true;
      if (src.includes('allegato2')) attachments.hasAttachment2 = true;
      
      if (linkHref && (linkHref.includes('.pdf') || linkHref.includes('.jpg') || linkHref.includes('.png'))) {
        const fullUrl = linkHref.startsWith('http') ? linkHref : `https://www.reggiocorre.it/${linkHref.replace(/^\//, '')}`;
        attachments.attachmentUrls.push(fullUrl);
      }
    }
  }
  
  // Analizza link diretti
  for (let link of links) {
    const href = link.href || link.getAttribute('href') || '';
    const text = link.textContent.toLowerCase();
    
    if (!href) continue;
    
    if (text.includes('iscri') || href.includes('endu.net') || href.includes('iscrizione')) {
      attachments.hasRegistration = true;
      if (!attachments.registrationUrl && href.startsWith('http')) {
        attachments.registrationUrl = href;
      }
    }
    
    if (href.includes('.pdf') || href.includes('.gpx')) {
      const fullUrl = href.startsWith('http') ? href : `https://www.reggiocorre.it/${href.replace(/^\//, '')}`;
      if (!attachments.attachmentUrls.includes(fullUrl)) {
        attachments.attachmentUrls.push(fullUrl);
      }
      if (href.includes('.gpx')) attachments.hasGPX = true;
    }
  }
  
  attachments.attachmentUrls = [...new Set(attachments.attachmentUrls)];
  
  return attachments;
      }
