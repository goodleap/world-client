/** Review the landscape in the real game without replacing the released map. */
export const landscapePreview = typeof location !== 'undefined'
  && new URLSearchParams(location.search).get('landscape') === 'preview';
