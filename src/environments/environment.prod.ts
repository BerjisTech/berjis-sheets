const w = typeof window !== 'undefined' ? (window as any) : {};

export const environment = {
  production: true,
  apiBase: w && typeof w.__BERJIS_API__ === 'string' && w.__BERJIS_API__.trim().length
    ? w.__BERJIS_API__.trim()
    : 'https://api.berjis.tech',
  sheetsApiBase: w && typeof w.__SHEETS_API__ === 'string' && w.__SHEETS_API__.trim().length
    ? w.__SHEETS_API__.trim()
    : 'https://sheets-api.berjis.tech'
};
