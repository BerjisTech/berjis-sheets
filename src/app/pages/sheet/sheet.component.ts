import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  standalone: true,
  selector: 'app-sheet',
  imports: [CommonModule],
  template: `<div class="border rounded p-4">Sheets grid placeholder (collab-ready slot)</div>`
})
export class SheetPageComponent {}

