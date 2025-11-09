import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CoreAuthService } from '@berjis/angular-auth';
import { SheetsService, SheetDoc } from '../../sheets.service';

@Component({
  standalone: true,
  selector: 'app-home',
  imports: [CommonModule, RouterLink],
  templateUrl: './home.component.html'
})
export class HomePageComponent {
  authed: boolean | null = null;
  recents: SheetDoc[] = [];
  constructor(private auth: CoreAuthService, private sheets: SheetsService) { this.init(); }
  async init() {
    try {
      const session = await this.auth.ensureAuth({ maxAgeMs: 1500 });
      this.authed = !!session?.valid;
      if (this.authed) { this.recents = await this.sheets.list(['active']); }
    } catch { this.authed = false; }
  }
}
