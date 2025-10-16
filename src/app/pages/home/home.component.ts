import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../api.service';
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
  constructor(private api: ApiService, private sheets: SheetsService) { this.init(); }
  async init() {
    try {
      const res = await this.api.ensureAuth();
      this.authed = !!res?.data?.valid;
      if (this.authed) { console.log(this.recents.filter(e => e.title)); this.recents = await this.sheets.list(['active']); }
    } catch { this.authed = false; }
  }
}
