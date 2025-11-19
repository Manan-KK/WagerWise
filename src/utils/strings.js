const stripHtmlTags = (value) => {
  if (!value || typeof value !== 'string') {
    return '';
  }
  return value.replace(/<\/?[^>]+(>|$)/g, ' ').replace(/\s+/g, ' ').trim();
};

module.exports = {
  stripHtmlTags
};
