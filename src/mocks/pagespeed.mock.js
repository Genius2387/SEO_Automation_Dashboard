module.exports = {
  url: 'https://example-dental-clinic.com',
  strategy: 'mobile',
  categories: {
    performance: { score: 0.61 },
    seo: { score: 0.89 },
    accessibility: { score: 0.74 }
  },
  audits: {
    'largest-contentful-paint': {
      score: 0.4,
      displayValue: '4.2 s'
    },
    'cumulative-layout-shift': {
      score: 0.9,
      displayValue: '0.08'
    },
    'interaction-to-next-paint': {
      score: 0.6,
      displayValue: '280 ms'
    },
    'render-blocking-resources': {
      score: 0.5,
      description: '2 blocking resources'
    },
    'unused-javascript': {
      score: 0.4,
      displayValue: '420 KiB'
    }
  }
};
