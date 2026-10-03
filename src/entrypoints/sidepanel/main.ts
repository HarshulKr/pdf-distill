// Side panel entry. Phase 0: only the file picker / drop zone is wired up.
// Conversion is added in Phase 1.

const dropZone = document.querySelector<HTMLLabelElement>('#drop-zone');
const fileInput = document.querySelector<HTMLInputElement>('#file-input');
const fileInfo = document.querySelector<HTMLElement>('#file-info');

if (!dropZone || !fileInput || !fileInfo) {
  throw new Error('Side panel markup is missing required elements');
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function showFile(file: File): void {
  if (!fileInfo) return;
  fileInfo.hidden = false;
  if (!isPdf(file)) {
    fileInfo.textContent = `"${file.name}" is not a PDF.`;
    fileInfo.classList.add('error');
    return;
  }
  fileInfo.classList.remove('error');
  const kb = Math.round(file.size / 1024);
  fileInfo.textContent = `Selected: ${file.name} (${kb.toLocaleString()} KB). Conversion arrives in Phase 1.`;
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) showFile(file);
});

// Keyboard access: the label is focusable, so Enter/Space should open the picker.
dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('dragging');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragging');
});

dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragging');
  const file = event.dataTransfer?.files[0];
  if (file) showFile(file);
});
