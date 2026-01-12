export function adjustTextareaHeight(textarea) {
    textarea.style.height = ''; // Reset the height
    textarea.style.height = textarea.scrollHeight + 'px'; // Set it to the scroll height
  }