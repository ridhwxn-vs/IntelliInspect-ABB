import { Component, OnInit, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart, registerables } from 'chart.js';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { RangeService } from '../../range.service';
import { ApiService } from '../../api.service';

Chart.register(...registerables);

@Component({
  selector: 'app-daterange',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './daterange.html',
  styleUrls: ['./daterange.css']
})
export class DaterangeComponent implements OnInit, AfterViewInit {
  
  datasetStart: string = '';
  datasetEnd: string = '';

  // User selections
  trainStart: string = '';
  trainEnd: string = '';
  testStart: string = '';
  testEnd: string = '';
  simStart: string = '';
  simEnd: string = '';

  // Derived
  trainDuration: number = 0;
  testDuration: number = 0;
  simDuration: number = 0;
  rangesValid: boolean = false;
  errorMsg: string = '';

  private chart: Chart | null = null;

  constructor(
    private rangeService: RangeService,
    private api: ApiService
  ) {}

  ngOnInit(): void {
    // Load dataset bounds saved at upload step
    const bounds = this.api.getDatasetBounds();
    this.datasetStart = bounds?.startDate || '';
    this.datasetEnd   = bounds?.endDate   || '';

    if (!this.datasetStart || !this.datasetEnd) {
      // Optional: show a friendly message or disable validate until upload is done
      console.warn('No dataset bounds in session — did you complete upload/analysis on Step 1?');
    }

    // Restore prior selections (if user navigated back)
    try {
      const raw = sessionStorage.getItem('miniml:ranges');
      if (raw) {
        const saved = JSON.parse(raw);
        this.trainStart = saved.trainStart || this.trainStart;
        this.trainEnd   = saved.trainEnd   || this.trainEnd;
        this.testStart  = saved.testStart  || this.testStart;
        this.testEnd    = saved.testEnd    || this.testEnd;
        this.simStart   = saved.simStart   || this.simStart;
        this.simEnd     = saved.simEnd     || this.simEnd;
      }
    } catch {}
  }

  ngAfterViewInit(): void {
    this.initChart();
  }

  validateRanges(): void {
    this.errorMsg = '';
    this.rangesValid = false;

    // presence
    if (!this.trainStart || !this.trainEnd || !this.testStart || !this.testEnd || !this.simStart || !this.simEnd) {
      this.errorMsg = 'Please select start and end dates for all three periods.';
      return;
    }

    // dataset bounds
    const ds = this.asDayStartFromServer(this.datasetStart);
    const de = this.asDayEndFromServer(this.datasetEnd);
    if (!ds || !de) {
      this.errorMsg = 'Dataset timestamp bounds are unavailable. Please re-upload the dataset.';
      return;
    }

    // parse user ranges (as local day start/end to match server’s 1s cadence)
    const t1s = this.asDayStart(this.trainStart);
    const t1e = this.asDayEnd(this.trainEnd);
    const t2s = this.asDayStart(this.testStart);
    const t2e = this.asDayEnd(this.testEnd);
    const t3s = this.asDayStart(this.simStart);
    const t3e = this.asDayEnd(this.simEnd);

    if (!t1s || !t1e || !t2s || !t2e || !t3s || !t3e) {
      this.errorMsg = 'Invalid date format.';
      return;
    }

    // each start <= end
    if (t1s > t1e || t2s > t2e || t3s > t3e) {
      this.errorMsg = 'Start date must be before or equal to end date for each period.';
      return;
    }

    // within dataset bounds (inclusive)
    const within = (s: Date, e: Date) => s >= ds && e <= de;
    if (!within(t1s, t1e)) { this.errorMsg = 'Training period is outside the dataset timestamp range.'; return; }
    if (!within(t2s, t2e)) { this.errorMsg = 'Testing period is outside the dataset timestamp range.';  return; }
    if (!within(t3s, t3e)) { this.errorMsg = 'Simulation period is outside the dataset timestamp range.'; return; }

    // durations (inclusive days)
    this.trainDuration = this.inclusiveDays(t1s, t1e);
    this.testDuration  = this.inclusiveDays(t2s, t2e);
    this.simDuration   = this.inclusiveDays(t3s, t3e);

    // Persist for next pages
    // 1) existing sim fields for your simulator page
    this.rangeService.simStart = this.simStart;
    this.rangeService.simEnd   = this.simEnd;

    // 2) store all six dates in session for the ML + Simulation steps
    try {
      sessionStorage.setItem('miniml:ranges', JSON.stringify({
        trainStart: this.trainStart,
        trainEnd:   this.trainEnd,
        testStart:  this.testStart,
        testEnd:    this.testEnd,
        simStart:   this.simStart,
        simEnd:     this.simEnd
      }));
    } catch {}

    this.rangesValid = true;
    this.updateChart();
  }

  // ---------- Chart ----------
  private initChart() {
    const ctx = document.getElementById('dateRangeChart') as HTMLCanvasElement | null;
    if (!ctx) return;

    this.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Training', 'Testing', 'Simulation'],
        datasets: [{
          label: 'Duration (days)',
          data: [0, 0, 0],
          backgroundColor: ['#28a745', '#fd7e14', '#0dcaf0'] 
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  private updateChart() {
    if (!this.chart) return;
    this.chart.data.datasets[0].data = [
      this.trainDuration,
      this.testDuration,
      this.simDuration
    ];
    this.chart.update();
  }

  // ---------- helpers ----------
  private asDayStart(dateStr: string): Date | null {

    if (!dateStr) return null;
    const d = new Date(`${dateStr}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  private asDayEnd(dateStr: string): Date | null {

    if (!dateStr) return null;
    const d = new Date(`${dateStr}T23:59:59`);
    return isNaN(d.getTime()) ? null : d;
  }

  private asDayStartFromServer(dateTimeStr: string): Date | null {
    
    if (!dateTimeStr) return null;
    const d = new Date(dateTimeStr.replace(' ', 'T'));

    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private asDayEndFromServer(dateTimeStr: string): Date | null {
    if (!dateTimeStr) return null;
    const d = new Date(dateTimeStr.replace(' ', 'T'));
    if (isNaN(d.getTime())) return null;
    d.setHours(23, 59, 59, 999);
    return d;
  }

  private inclusiveDays(start: Date, end: Date): number {
    const MS = 24 * 60 * 60 * 1000;
    return Math.floor((end.getTime() - start.getTime()) / MS) + 1;
  }
}
