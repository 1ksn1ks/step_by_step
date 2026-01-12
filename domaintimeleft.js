document.getElementById("button4").addEventListener("click", async () => {

    const domain = document.getElementById("toolbar-input").value.toLowerCase();
    const domainObject = loadedDomains.find(d => d.domain === domain);
  
    if (domainObject) {
  
      const currentTime = Date.now() / 1000; // Get current time in seconds
  
      const timeLeftInSeconds = domainObject.addedTime - currentTime;
  
      const days = Math.floor(timeLeftInSeconds / (24 * 3600));
      const hours = Math.floor((timeLeftInSeconds % (24 * 3600)) / 3600);
      const minutes = Math.floor((timeLeftInSeconds % 3600) / 60);
      const seconds = Math.floor(timeLeftInSeconds % 60);
  
      const formattedTimeLeft = `${days}d ${hours}h ${minutes}m ${seconds}s`;
  
      document.getElementById("domain-time-left").textContent = `Time left: ${formattedTimeLeft}`;
    } else {
      console.warn("Domain not found in loadedDomains.");
      document.getElementById("domain-time-left").textContent = 'no one uses this domain';
    }
  });