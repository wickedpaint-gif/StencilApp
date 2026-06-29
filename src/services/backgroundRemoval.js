/**
 * Background removal service using FAPIhub API via backend proxy.
 * The proxy endpoint keeps the API key server-side and never exposes it to the client.
 */

/**
 * Remove background from an image file or data URL.
 *
 * @param {File|string} imageSource - A File object or a data URL string
 * @returns {Promise<{success: boolean, imageUrl?: string, error?: string}>}
 */
export async function removeBackground(imageSource) {
  try {
    // Convert data URL to a File/Blob if needed
    let file;
    if (typeof imageSource === 'string') {
      // Synchronous conversion — avoids the browser-dependent fetch(data:) hang on large images
      const [header, base64] = imageSource.split(',');
      const mime = header.split(':')[1].split(';')[0];
      const byteString = atob(base64);
      const arr = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i++) arr[i] = byteString.charCodeAt(i);
      const blob = new Blob([arr], { type: mime });
      file = new File([blob], 'image.png', { type: mime });
    } else {
      file = imageSource;
    }

    const formData = new FormData();
    // FAPIhub expects the field name "image"
    formData.append('image', file);

    const response = await fetch('/api/remove-background', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      let errorMessage = `Background removal failed (${response.status})`;
      try {
        const errData = await response.json();
        if (errData.error) errorMessage = errData.error;
      } catch (_) { /* ignore parse errors */ }
      return { success: false, error: errorMessage };
    }

    const blob = await response.blob();
    const imageUrl = URL.createObjectURL(blob);
    return { success: true, imageUrl };
  } catch (err) {
    console.error('Background removal error:', err);
    const message = err?.message?.includes('fetch')
      ? 'Could not reach the background removal service. Check your connection.'
      : 'Background removal failed. Please try again.';
    return { success: false, error: message };
  }
}