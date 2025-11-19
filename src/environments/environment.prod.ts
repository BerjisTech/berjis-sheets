type SheetsWindow = Window & {
  __BERJIS_API__?: string;
  __SHEETS_API__?: string;
};

const w: SheetsWindow | undefined = typeof window !== 'undefined' ? (window as SheetsWindow) : undefined;

export const environment = {
  production: true,
  apiBase: w && typeof w.__BERJIS_API__ === 'string' && w.__BERJIS_API__.trim().length
    ? w.__BERJIS_API__.trim()
    : 'https://api.berjis.tech',
  sheetsApiBase: w && typeof w.__SHEETS_API__ === 'string' && w.__SHEETS_API__.trim().length
    ? w.__SHEETS_API__.trim()
    : 'https://sheets-api.berjis.tech'
};
