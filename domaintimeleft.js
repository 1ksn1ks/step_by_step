import { loadedDomains } from "./loaddomains";

document.getElementById("button4").addEventListener("click", async () => {

    const domain = document.getElementById("domain-name-input").value.toLowerCase();
    const domainObject = loadedDomains.find(d => d.domain === domain);

    console.log('[check-domain] input:', JSON.stringify(domain), '| loadedDomains count:', loadedDomains.length);

    if (domainObject) {
      console.log('[check-domain] FOUND:', domainObject.domain, '| addedTime:', domainObject.addedTime);

      const currentTime = Date.now() / 1000; // Get current time in seconds
  
      const timeLeftInSeconds = domainObject.addedTime - currentTime;
  
      const days = Math.floor(timeLeftInSeconds / (24 * 3600));
      const hours = Math.floor((timeLeftInSeconds % (24 * 3600)) / 3600);
      const minutes = Math.floor((timeLeftInSeconds % 3600) / 60);
      const seconds = Math.floor(timeLeftInSeconds % 60);
  
      const formattedTimeLeft = `${days}d ${hours}h ${minutes}m ${seconds}s`;
  
      document.getElementById("domain-time-left").textContent = `Time left: ${formattedTimeLeft}`;
    } else {
      const ci = loadedDomains.find(d => String(d.domain).toLowerCase() === domain);
      console.warn('[check-domain] NOT FOUND in loadedDomains.');
      console.log('[check-domain] case-insensitive match:', ci ? ci.domain : 'none');
      console.log('[check-domain] sample loaded domains (first 10):', loadedDomains.slice(0, 10).map(d => d.domain));
      document.getElementById("domain-time-left").textContent = 'no one uses this domain';
    }
  });