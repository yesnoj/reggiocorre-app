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
  
  // Trova tutte le righe della tabella del calendario
  const rows = document.querySelectorAll('tr');
  
  let id = 1;
  
  for (let row of rows) {
    try {
      // Cerca celle con classe specifica per le date
      const dateCell = row.querySelector('td[style*="background-color:#FFFF99"]') || 
                       row.querySelector('td[bgcolor="#FFFF99"]');
      
      if (!dateCell) continue;
      
      const dateText = dateCell.textContent.trim();
      const dateMatch = dateText.match(/(\d{1,2})\/(\d{1,2})/);
      
      if (!dateMatch) continue;
      
      const [_, day, month] = dateMatch;
      const year = new Date().getFullYear();
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      
      // Estrai altre celle della riga
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) continue;
      
      // Struttura tipica: [data, giorno, provincia, ora, dettagli]
      let timeText = '';
      let titleText = '';
      let venueText = '';
      let description = '';
      let provinceCode = 'XY';
      
      // Cerca l'orario (formato HH:MM)
      for (let cell of cells) {
        const text = cell.textContent.trim();
        if (/^\d{1,2}:\d{2}$/.test(text)) {
          timeText = text;
          break;
        }
      }
      
      // Cerca il codice provincia (RE, MO, BO, etc)
      for (let cell of cells) {
        const text = cell.textContent.trim();
        if (/^[A-Z]{2}$/.test(text) && text.length === 2) {
          provinceCode = text;
          break;
        }
      }
      
      // Cerca il titolo (spesso in grassetto o in una cella specifica)
      const titleCell = row.querySelector('td b') || row.querySelector('td strong');
      if (titleCell) {
        titleText = titleCell.textContent.trim();
      } else {
        // Fallback: cerca la cella con più testo
        let maxLength = 0;
        for (let cell of cells) {
          const text = cell.textContent.trim();
          if (text.length > maxLength && text.length > 10 && !text.includes('png')) {
            titleText = text;
            maxLength = text.length;
          }
        }
      }
      
      // Estrai descrizione completa e venue dalla riga e dalle righe successive
      let currentRow = row;
      let descriptionLines = [];
      let foundVenue = false;
      
      // Cerca nelle prossime 3 righe per dettagli aggiuntivi
      for (let i = 0; i < 3; i++) {
        currentRow = currentRow.nextElementSibling;
        if (!currentRow) break;
        
        const textContent = currentRow.textContent.trim();
        
        // Salta righe vuote o con solo icone
        if (!textContent || textContent.length < 5 || textContent.includes('png')) continue;
        
        // Se troviamo una nuova data, fermiamoci
        if (/\d{1,2}\/\d{1,2}/.test(textContent.substring(0, 10))) break;
        
        descriptionLines.push(textContent);
        
        // Il venue è spesso la prima riga dopo il titolo
        if (!foundVenue && textContent.length > 10) {
          venueText = textContent;
          foundVenue = true;
        }
      }
      
      description = descriptionLines.join(' ').trim();
      
      // Estrai distanze dalla descrizione
      const distances = extractDistances(description + ' ' + titleText);
      
      if (distances.length === 0) continue;
      
      // Estrai località dal venue
      let location = extractLocation(venueText);
      
      // Converti codice provincia in nome completo
      let provinceName = 'Fuori Provincia';
      if (provinceCode === 'MO') provinceName = 'Modena';
      else if (provinceCode === 'RE') provinceName = 'Reggio Emilia';
      else if (provinceCode === 'BO') provinceName = 'Bologna';
      else if (provinceCode === 'PR') provinceName = 'Parma';
      
      // Determina il tipo di gara
      let type = 'Corsa su strada';
      const descLower = (titleText + ' ' + description).toLowerCase();
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
      const organizerMatch = description.match(/(?:Organizzatore|Societ[àa] o gruppo sportivo):\s*([^-\n]+)/i);
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
      
      // Estrai telefono - FORMATTATO CON SPAZI
      let phoneNumber = null;
      const phoneMatch = description.match(/(\d{3})[\s\-]?(\d{3,4})[\s\-]?(\d{4})/);
      if (phoneMatch) {
        phoneNumber = `${phoneMatch[1]} ${phoneMatch[2]}${phoneMatch[3]}`;
      }
      
      // ESTRAI ALLEGATI - Cerca tutte le immagini nella riga
      const attachments = extractAttachments(row, venueText, emailAddress);
      
      // NON rimuovere numeri dall'edizione nel titolo
      const cleanTitle = titleText.trim();
      
      // Aggiungi solo se abbiamo dati minimi
      if (cleanTitle && cleanTitle.length > 3 && location && distances.length > 0) {
        races.push({
          id: id++,
          date,
          time: timeText || '09:00',
          title: cleanTitle,
          location: location,
          province: provinceName,
          provinceCode: provinceCode,
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
  
  // Pattern per distanze: "1.5 km", "10km", "21,097", "5-10-21"
  const patterns = [
    /(\d+[,.]?\d*)\s*km/gi,
    /(\d+[,.]?\d*)\s*-\s*(\d+[,.]?\d*)\s*-\s*(\d+[,.]?\d*)/g,
    /(?:^|\s)(\d+[,.]?\d*)(?:\s|$)/g
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
    return parts[parts.length - 1].trim();
  }
  
  // Oppure le prime 3 parole
  const words = venue.split(' ').slice(0, 3).join(' ');
  return words.length > 50 ? venue.substring(0, 50) : words;
}

function extractAttachments(row, venue, emailAddress) {
  const attachments = {
    hasCalendar: true, // Sempre disponibile (la nostra funzione)
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
  
  // Cerca tutte le immagini e link nella riga
  const images = row.querySelectorAll('img');
  const links = row.querySelectorAll('a');
  
  for (let img of images) {
    const src = img.src || img.getAttribute('src') || '';
    const alt = img.alt || '';
    const srcLower = src.toLowerCase();
    
    // Trova il link parent se esiste
    let parentLink = img.closest('a');
    let linkHref = parentLink ? parentLink.href : null;
    
    // Maps
    if (srcLower.includes('maps') || srcLower.includes('mappa')) {
      attachments.hasMaps = true;
      if (!attachments.mapLink && venue) {
        attachments.mapLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue)}`;
      }
    }
    
    // Calendar
    if (srcLower.includes('calendar') || srcLower.includes('calendario')) {
      attachments.hasCalendar = true;
    }
    
    // Email
    if (srcLower.includes('email') || srcLower.includes('mail')) {
      attachments.hasEmail = true;
      if (emailAddress) {
        attachments.emailAddress = emailAddress;
      }
    }
    
    // Website
    if (srcLower.includes('www') || srcLower.includes('web') || srcLower.includes('sito')) {
      attachments.hasWebsite = true;
      if (linkHref && (linkHref.startsWith('http') || linkHref.startsWith('www'))) {
        attachments.websiteUrl = linkHref.startsWith('http') ? linkHref : 'https://' + linkHref;
      }
    }
    
    // Iscrizione
    if (srcLower.includes('iscrizione') || srcLower.includes('registration') || alt.toLowerCase().includes('iscrizione')) {
      attachments.hasRegistration = true;
      if (linkHref && linkHref.startsWith('http')) {
        attachments.registrationUrl = linkHref;
      }
    }
    
    // GPX
    if (srcLower.includes('gpx') || alt.toLowerCase().includes('gpx')) {
      attachments.hasGPX = true;
      if (linkHref && linkHref.includes('.gpx')) {
        attachments.attachmentUrls.push(linkHref);
      }
    }
    
    // Allegati generici (allegato1, allegato2, locandina, etc)
    if (srcLower.includes('allegato1') || srcLower.includes('locandina')) {
      attachments.hasAttachment1 = true;
      if (linkHref && (linkHref.includes('.pdf') || linkHref.includes('.jpg') || linkHref.includes('.png'))) {
        // Converti link relativi in assoluti
        const fullUrl = linkHref.startsWith('http') ? linkHref : 'https://www.reggiocorre.it/' + linkHref.replace(/^\//, '');
        attachments.attachmentUrls.push(fullUrl);
      }
    }
    
    if (srcLower.includes('allegato2') || srcLower.includes('regolamento')) {
      attachments.hasAttachment2 = true;
      if (linkHref && (linkHref.includes('.pdf') || linkHref.includes('.jpg') || linkHref.includes('.png'))) {
        const fullUrl = linkHref.startsWith('http') ? linkHref : 'https://www.reggiocorre.it/' + linkHref.replace(/^\//, '');
        attachments.attachmentUrls.push(fullUrl);
      }
    }
  }
  
  // Cerca link diretti (senza immagini)
  for (let link of links) {
    const href = link.href;
    const text = link.textContent.toLowerCase();
    
    if (!href) continue;
    
    // Link iscrizione
    if (text.includes('iscri') || href.includes('iscrizione') || href.includes('endu.net') || href.includes('cronometraggio')) {
      attachments.hasRegistration = true;
      if (!attachments.registrationUrl) {
        attachments.registrationUrl = href;
      }
    }
    
    // Sito web
    if ((text.includes('sito') || text.includes('web') || text.includes('www')) && href.startsWith('http')) {
      attachments.hasWebsite = true;
      if (!attachments.websiteUrl) {
        attachments.websiteUrl = href;
      }
    }
    
    // GPX o file scaricabili
    if (href.includes('.gpx') || href.includes('.pdf') || href.includes('.jpg')) {
      const fullUrl = href.startsWith('http') ? href : 'https://www.reggiocorre.it/' + href.replace(/^\//, '');
      if (!attachments.attachmentUrls.includes(fullUrl)) {
        attachments.attachmentUrls.push(fullUrl);
      }
      
      if (href.includes('.gpx')) {
        attachments.hasGPX = true;
      }
    }
  }
  
  // Deduplica attachmentUrls
  attachments.attachmentUrls = [...new Set(attachments.attachmentUrls)];
  
  return attachments;
}