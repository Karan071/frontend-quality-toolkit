import { getScreenshot } from './shared/store';

async function main() {
  const id = new URLSearchParams(location.search).get('id');
  const shot = id ? await getScreenshot(id) : undefined;
  const name = document.getElementById('name')!;
  if (!shot) {
    name.textContent = 'Screenshot not found (it may have been deleted).';
    return;
  }
  const url = URL.createObjectURL(shot.blob);
  const img = document.getElementById('img') as HTMLImageElement;
  img.src = url;
  img.alt = `${shot.type} screenshot of ${shot.meta.title || shot.meta.url}`;
  name.textContent = shot.name;
  document.title = shot.name;
  document.getElementById('meta')!.textContent = `${shot.width} × ${shot.height} · ${(shot.bytes / 1024).toFixed(0)} KB · ${shot.meta.url}`;
  document.getElementById('zoom')!.addEventListener('click', (e) => {
    const actual = img.classList.toggle('actual');
    (e.currentTarget as HTMLButtonElement).textContent = actual ? 'Fit to window' : 'Actual size';
  });
  document.getElementById('save')!.addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = shot.name;
    a.click();
  });
}

void main();
