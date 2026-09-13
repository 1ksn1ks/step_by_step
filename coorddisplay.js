function adjustButtonSize() {
    const coordinatesDisplay = document.getElementById('coordinates-display');
    const copyCoordinatesButton = document.getElementById('copy-coordinates');

    // Use the rendered size (includes padding and border) so the
    // button exactly matches the display
    const rect = coordinatesDisplay.getBoundingClientRect();
    copyCoordinatesButton.style.width = `${rect.width}px`;
    copyCoordinatesButton.style.height = `${rect.height}px`;
  }

  // Call the function initially to set the size
  adjustButtonSize();

  // Optionally, add an event listener to adjust size on window resize
  window.addEventListener('resize', adjustButtonSize);

  // Track the display as its own width changes with the coordinates text
  const coordinatesDisplay = document.getElementById('coordinates-display');
  new ResizeObserver(adjustButtonSize).observe(coordinatesDisplay);