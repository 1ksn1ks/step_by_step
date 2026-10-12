// Phone storage notice. Saved topics, names, and pictures stay on the phone.
import { toast } from './toast';

window.addEventListener('topic-cache-full', () => {
  toast.error('Phone storage is full.');
});
