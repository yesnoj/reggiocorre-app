// api/scraper.js - Vercel Serverless Function (COMPLETELY REWRITTEN)
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
        cellTexts: Array.from(row.querySelectorAll('td')).map(td => td.textContent.trim().substring(0, 50))
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
  
  // Trova tutti gli elementi che contengono le gare (righe della tabella)
  const allRows = Array.from(document.querySelectorAll('tr'));
  
  console.log(`Total rows found: ${allRows.length}`);
  
  let id = 1;
  
  for (let i = 0; i < allRows.length; i++) {
    try {
      const row = allRows[i];
      const cells = Array.from(row.querySelectorAll('td'));
      
      // Struttura tipica: [Data+Giorno] | [Ora] | [Titolo+Venue+Desc+Icone] | [Distanze]
      // Minimo 4 celle
      if (cells.length < 4) continue;
      
      // CELLA 0: Data (in <b>) + giorno settimana + provincia
      const dateElement = cells[0].querySelector('b');
      if (!dateElement) continue;
      
      const dateText = dateElement.textContent.trim();
      const dateMatch = dateText.match(/^(\d{1,2})\/(\d{1,2})$/);
      if (!dateMatch) continue;
      
      const [_, day, month] = dateMatch;
      const year = new Date().getFullYear();
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      
      // Estrai provincia dalla prima cella (es: "RE" o "MO")
      const firstCellFullText = cells[0].textContent;
      let provinceCode = 'XY';
      
      // Cerca codice provincia (2 lettere maiuscole)
      const provinceMatch = firstCellFullText.match(/\b([A-Z]{2})\b/);
      if (provinceMatch) {
        provinceCode = provinceMatch[1];
      }
      
      // CELLA 1: Orario
      const timeText = cells[1]?.textContent.trim() || '09:00';
      
      // CELLA 2: Contiene TUTTO (titolo, venue, descrizione, icone)
      // Questa è la cella principale con tutte le info
      const mainCell = cells[2];
      if (!mainCell) continue;
      
      const mainCellText = mainCell.textContent;
      
      // Il TITOLO è spesso la prima linea in grassetto o il primo testo lungo
      let title = '';
      const boldElements = mainCell.querySelectorAll('b');
      
      // Cerca il primo bold element che non sia solo numeri
      for (let bold of boldElements) {
        const boldText = bold.textContent.trim();
        if (boldText.length > 5 && !/^[\d\s\-,\.]+$/.test(boldText)) {
          title = boldText;
          break;
        }
      }
      
      // Se non trovato in bold, cerca nel testo della cella
      if (!title) {
        const lines = mainCellText.split('\n').map(l => l.trim()).filter(l => l.length > 10);
        for (let line of lines) {
          if (!/^[\d\s\-,\.]+$/.test(line) && !line.includes('png/')) {
            title = line;
            break;
          }
        }
      }
      
      if (!title || title.length < 3) continue;
      
      // VENUE: Cerca righe con "Via", "Piazza", "Corso", o località con virgole
      let venue = '';
      const lines = mainCellText.split('\n').map(l => l.trim()).filter(Boolean);
      
      for (let line of lines) {
        if (line === title) continue;
        if (line.includes('Via ') || line.includes('Piazza ') || line.includes('Corso ') || 
            line.includes('campo ') || line.includes('Centro ') || line.includes('Parcheggio ') ||
            (line.includes(',') && line.length > 15 && line.length < 150)) {
          venue = line;
          break;
        }
      }
      
      // LOCATION: Estrai dalla venue (ultima parte dopo virgola)
      let location = 'N/D';
      if (venue) {
        const venueParts = venue.split(',').map(p => p.trim());
        if (venueParts.length > 0) {
          // Prendi l'ultima parte
          const lastPart = venueParts[venueParts.length - 1];
          // Se l'ultima parte è corta e sensata, è la città
          if (lastPart && lastPart.length > 2 && lastPart.length < 40 && !/^\d/.test(lastPart)) {
            location = lastPart;
          } else if (venueParts.length > 1) {
            location = venueParts[venueParts.length - 2];
          }
        }
      }
      
      // Se location non trovata, cerca nei testi
      if (location === 'N/D') {
        for (let line of lines) {
          if (line !== title && line.length < 40 && /^[A-Z]/.test(line) && !line.includes('Società')) {
            location = line;
            break;
          }
        }
      }
      
      // DESCRIZIONE: Tutto il testo che non è titolo né venue
      let description = '';
      for (let line of lines) {
        if (line === title || line === venue) continue;
        if (line.includes('png/')) continue;
        if (line.length > 10) {
          description += ' ' + line;
        }
      }
      
      description = description
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 500);
      
      // CELLA 3 o ULTIMA: Le distanze (es: "4,5 - 10 -21")
      // Le distanze sono nell'ultima cella con numeri
      let distancesText = '';
      
      // Cerca dall'ultima cella verso sinistra
      for (let j = cells.length - 1; j >= 0; j--) {
        const cellText = cells[j].textContent.trim();
        // Se la cella contiene solo numeri, trattini, virgole e spazi
        if (cellText && /^[\d\s\-,\.]+$/.test(cellText) && cellText.length > 1) {
          distancesText = cellText;
          break;
        }
      }
      
      // Estrai distanze
      const distances = extractDistances(distancesText + ' ' + title + ' ' + description);
      if (distances.length === 0) continue;
      
      // Nome provincia completo
      let provinceName = 'Fuori Provincia';
      if (provinceCode === 'MO') provinceName = 'Modena';
      else if (provinceCode === 'RE') provinceName = 'Reggio Emilia';
      else if (provinceCode === 'BO') provinceName = 'Bologna';
      else if (provinceCode === 'PR') provinceName = 'Parma';
      
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
      else if (descLower.includes('gratuito') || descLower.includes('gratis') || 
               descLower.includes('libera') || descLower.includes('partecipazione libera')) {
        price = 'Gratuito';
      }
      
      // Organizzatore
      let organizer = null;
      const organizerMatch = description.match(/Organizzatore:\s*([^\-\n]+?)(?:\s*\-|\n|$)/i);
      if (organizerMatch) organizer = organizerMatch[1].trim();
      
      // Società
      let society = null;
      const societyMatch = description.match(/Societ[àa] o gruppo sportivo:\s*([^\n]+?)(?:Organizzatore|Contatti|$)/i);
      if (societyMatch) society = societyMatch[1].trim();
      
      // Email
      let emailAddress = null;
      const emailMatch = description.match(/[\w\.-]+@[\w\.-]+\.\w+/);
      if (emailMatch) emailAddress = emailMatch[0];
      
      // Telefono
      let phoneNumber = null;
      const phoneMatch = description.match(/(\d{3})[\s\-]?(\d{3,4})[\s\-]?(\d{4})/);
      if (phoneMatch) {
        phoneNumber = `${phoneMatch[1]} ${phoneMatch[2]}${phoneMatch[3]}`;
      }
      
      // Estrai allegati dalla cella principale (celle[2])
      const attachments = extractAttachments(mainCell, venue, emailAddress);
      
      races.push({
        id: id++,
        date,
        time: timeText,
        title,
        location,
        province: provinceName,
        provinceCode,
        venue: venue || location,
        distances: [...new Set(distances)].sort((a, b) => a - b),
        description,
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
  
  // Pattern per trovare distanze
  const patterns = [
    /(\d+[,.]?\d*)\s*km/gi,
    /(\d+[,.]?\d*)\s*[-–]\s*(\d+[,.]?\d*)\s*[-–]\s*(\d+[,.]?\d*)/g,
    /(\d+[,.]?\d*)\s*[-–]\s*(\d+[,.]?\d*)/g,
    /(\d+[,.]?\d*)/g
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

function extractAttachments(cell, venue, emailAddress) {
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
  
  const images = cell.querySelectorAll('img');
  const links = cell.querySelectorAll('a');
  
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
    
    if (text.includes('iscri') || href.includes('endu.net') || href.includes('iscrizione') || href.includes('irunning')) {
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