function adjustButtonSize() {
    const coordinatesDisplay = document.getElementById('coordinates-display');
    const copyCoordinatesButton = document.getElementById('copy-coordinates');

    // Get the computed styles of the input field
    const computedStyle = window.getComputedStyle(coordinatesDisplay);

    // Parse the width and height to numbers (removing 'px')
    const width = parseFloat(computedStyle.width);
    const height = parseFloat(computedStyle.height);

    // Add a bit extra (e.g., 10px) and set back as strings with 'px'
    copyCoordinatesButton.style.width = `${width + 30}px`;
    copyCoordinatesButton.style.height = `${height + 10}px`;
  }

  // Call the function initially to set the size
  adjustButtonSize();

  // Optionally, add an event listener to adjust size on window resize
  window.addEventListener('resize', adjustButtonSize);