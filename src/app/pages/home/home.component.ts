import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  standalone: true,
  selector: 'app-home',
  imports: [CommonModule],
  template: `<p class="text-gray-700">Sheets home. Open a demo sheet from the nav.</p>`
})
export class HomePageComponent {}

