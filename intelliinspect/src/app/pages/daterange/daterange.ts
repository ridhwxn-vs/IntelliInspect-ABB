import { Component, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart, registerables } from 'chart.js';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router'; 
import { RangeService } from '../../range.service';

Chart.register(...registerables);

@Component({
  selector: 'app-daterange',
  imports: [CommonModule, FormsModule,RouterModule],
  templateUrl: './daterange.html',
  styleUrls: ['./daterange.css']
})

export class DaterangeComponent implements AfterViewInit {
  trainStart: string = '';
  trainEnd: string = '';
  testStart: string = '';
  testEnd: string = '';
  simStart: string = '';
  simEnd: string = '';

  trainDuration: number = 0;
  testDuration: number = 0;
  simDuration: number = 0;
  rangesValid: boolean = false;

  private chart: Chart | null = null;
  constructor(private rangeService: RangeService) {};

  ngAfterViewInit(): void {
    this.initChart();
  }

  validateRanges() {
  if (this.trainStart && this.trainEnd && this.testStart && this.testEnd && this.simStart && this.simEnd) {
    this.trainDuration = this.calcDays(this.trainStart, this.trainEnd);
    this.testDuration = this.calcDays(this.testStart, this.testEnd);
    this.simDuration = this.calcDays(this.simStart, this.simEnd);

    // ✅ Save in service
    this.rangeService.simStart = this.simStart;
    this.rangeService.simEnd = this.simEnd;

    this.rangesValid = true;
    this.updateChart();
  }
  }

  private calcDays(start: string, end: string): number {
    const s = new Date(start);
    const e = new Date(end);
    return Math.max(0, Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)));
  }

  private initChart() {
    const ctx = document.getElementById('dateRangeChart') as HTMLCanvasElement;
    if (ctx) {
      this.chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ['Training', 'Testing', 'Simulation'],
          datasets: [{
            label: 'Duration (days)',
            data: [0, 0, 0],
            backgroundColor: ['#28a745', '#fd7e14', '#0dcaf0'] // green, orange, blue
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false }
          },
          scales: {
            y: { beginAtZero: true }
          }
        }
      });
    }
  }

  private updateChart() {
    if (this.chart) {
      this.chart.data.datasets[0].data = [
        this.trainDuration,
        this.testDuration,
        this.simDuration
      ];
      this.chart.update();
    }
  }
}
