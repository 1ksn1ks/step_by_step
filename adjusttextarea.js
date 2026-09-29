export function adjustTextareaHeight(textarea) {
    // The chat message lists are sized by fitChatMessages (fixed panel),
    // never by their content
    if (textarea.id === "messages-from-topic-chat" || textarea.id === "messages-from-encrypted-chat") return;
    textarea.style.height = ''; // Reset the height
    textarea.style.height = textarea.scrollHeight + 'px'; // Set it to the scroll height
  }