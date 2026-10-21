// A failed metadata preload must not leave a usable clip permanently unplayable.
export function playClip(slide, { muted = true } = {}) {
  const video = slide?.querySelector('video');
  if (!video || slide.dataset.invalid === '1') return;
  if (slide.dataset.state === 'error' || video.error || video.networkState === 3) {
    slide.dataset.state = 'loading';
    video.load();
  }
  video.muted = muted;
  try {
    const playing = video.play();
    playing?.catch(() => { slide.dataset.paused = '1'; });
  } catch { slide.dataset.paused = '1'; }
}

export function retryClip(slide, { play = false, muted = true } = {}) {
  const video = slide?.querySelector('video');
  if (!video) return;
  slide.dataset.state = 'loading';
  video.load();
  if (play) playClip(slide, { muted });
}
