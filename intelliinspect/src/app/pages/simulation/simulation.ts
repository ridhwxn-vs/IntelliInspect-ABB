import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Chart, registerables } from 'chart.js';
import { RangeService } from '../../range.service';

Chart.register(...registerables);

interface PredictionRow {
  time: string;
  sampleId: number;
  prediction: string;
  confidence: number;
  temperature: number;
  pressure: number;
  humidity: number;
}

@Component({
  selector: 'app-simulation',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './simulation.html',
  styleUrls: ['./simulation.css']
})
export class SimulationComponent {
  running = false;
  finished = false;
  errorMsg = '';

  total = 0;
  pass = 0;
  fail = 0;
  avgConf = 0;
  rows: PredictionRow[] = [];

  private lineChart: Chart | null = null;
  private donutChart: Chart | null = null;
  private intervalId: any;
  private totalRecords = 0;

  constructor(private rangeService: RangeService) {}

  // --- helpers to normalize dates to "yyyy-MM-dd HH:mm:ss" ---
  private pad(n: number) { return String(n).padStart(2, '0'); }
  private fmtLocal(d: Date): string {
    return `${d.getFullYear()}-${this.pad(d.getMonth()+1)}-${this.pad(d.getDate())} ` +
           `${this.pad(d.getHours())}:${this.pad(d.getMinutes())}:${this.pad(d.getSeconds())}`;
  }
  private toYYYYmmddHHMMSS(input: any): string {
    if (!input) return '';
    if (typeof input === 'string') {
      let s = input.trim().replace('T', ' ');
      if (s.endsWith('Z')) return this.fmtLocal(new Date(input));
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return `${s}:00`;
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+$/.test(s)) s = s.split('.')[0];
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
      const d = new Date(s);
      return isNaN(d.getTime()) ? '' : this.fmtLocal(d);
    }
    if (input instanceof Date) return this.fmtLocal(input);
    return '';
  }
  private addSeconds(isoLike: string, sec: number): string {
    const d = new Date(isoLike.replace(' ', 'T'));
    if (isNaN(d.getTime())) return '';
    d.setSeconds(d.getSeconds() + sec);
    return this.fmtLocal(d);
  }
  private addDays(isoLike: string, days: number): string {
    const d = new Date(isoLike.replace(' ', 'T'));
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + days);
    return this.fmtLocal(d);
  }

  /** Pull ranges from sessionStorage; fall back to RangeService; derive sim window if missing. */
  private loadRanges(): {
    trainStart: string; trainEnd: string; testStart: string; testEnd: string;
    simStart: string; simEnd: string;
  } | null {
    let ranges: any = {};
    try { ranges = JSON.parse(sessionStorage.getItem('miniml:ranges') || '{}'); } catch {}

    let { trainStart, trainEnd, testStart, testEnd, simStart, simEnd } = ranges;

    // fall back to RangeService for sim window if user typed it there
    if (!simStart && this.rangeService.simStart) simStart = this.rangeService.simStart;
    if (!simEnd   && this.rangeService.simEnd)   simEnd   = this.rangeService.simEnd;

    // normalize
    trainStart = this.toYYYYmmddHHMMSS(trainStart);
    trainEnd   = this.toYYYYmmddHHMMSS(trainEnd);
    testStart  = this.toYYYYmmddHHMMSS(testStart);
    testEnd    = this.toYYYYmmddHHMMSS(testEnd);
    simStart   = this.toYYYYmmddHHMMSS(simStart);
    simEnd     = this.toYYYYmmddHHMMSS(simEnd);

    // derive simulation window if absent
    if (!simStart && testEnd) simStart = this.addSeconds(testEnd, 1);
    if (!simEnd && simStart)  simEnd   = this.addDays(simStart, 60);

    // final validation
    if (!trainStart || !trainEnd || !testStart || !testEnd || !simStart || !simEnd) {
      return null;
    }

    // persist back to service so the header/date widgets (if any) can use it
    this.rangeService.simStart = simStart;
    this.rangeService.simEnd   = simEnd;

    return { trainStart, trainEnd, testStart, testEnd, simStart, simEnd };
  }

  toggleSimulation() {
    if (this.running) {
      this.stopSimulation();
    } else {
      this.startSimulation();
    }
  }

  stopSimulation() {
    this.running = false;
    clearInterval(this.intervalId);
    this.finished = true;
  }

  startSimulation() {
    if (this.running) return;

    const r = this.loadRanges();
    if (!r) {
      this.errorMsg = 'Invalid date ranges. Please reselect Step 2 ranges.';
      return;
    }
    this.errorMsg = '';

    this.running = true;
    this.finished = false;
    this.reset();

    // Calculate total "records" ~ days between simStart/simEnd
    const start = new Date(r.simStart.replace(' ', 'T'));
    const end   = new Date(r.simEnd.replace(' ', 'T'));
    this.totalRecords = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));

    // Init charts
    this.initCharts();

    let sampleId = 1;
    this.intervalId = setInterval(() => {
      if (this.total >= this.totalRecords) {
        this.stopSimulation();
        return;
      }

      // Random (placeholder) prediction signals
      const prediction = Math.random() > 0.3 ? 'Pass' : 'Fail';
      const confidence = Math.floor(Math.random() * 30) + 70; // 70–100
      const temperature = 20 + Math.random() * 5;
      const pressure = 1000 + Math.random() * 20;
      const humidity = 40 + Math.random() * 10;

      this.total++;
      if (prediction === 'Pass') this.pass++; else this.fail++;
      this.avgConf = ((this.avgConf * (this.total - 1)) + confidence) / this.total;

      // advance by 1 day per tick
      const tickDate = new Date(start.getTime() + this.total * 24 * 60 * 60 * 1000);
      const nowLabel = tickDate.toLocaleDateString();

      // Update table
      this.rows.unshift({
        time: nowLabel,
        sampleId: sampleId++,
        prediction,
        confidence,
        temperature: +temperature.toFixed(1),
        pressure: +pressure.toFixed(1),
        humidity: +humidity.toFixed(1)
      });
      if (this.rows.length > 10) this.rows.pop();

      // Update charts
      if (this.lineChart) {
        this.lineChart.data.labels?.push(nowLabel);
        (this.lineChart.data.datasets[0].data as number[]).push(confidence);
        if ((this.lineChart.data.labels as string[]).length > 20) {
          this.lineChart.data.labels?.shift();
          (this.lineChart.data.datasets[0].data as number[]).shift();
        }
        this.lineChart.update();
      }
      if (this.donutChart) {
        this.donutChart.data.datasets[0].data = [this.pass, this.fail];
        this.donutChart.update();
      }
    }, 500);
  }

  private reset() {
    this.total = 0;
    this.pass = 0;
    this.fail = 0;
    this.avgConf = 0;
    this.rows = [];
    if (this.intervalId) clearInterval(this.intervalId);
  }

  private initCharts() {
    const ctx1 = document.getElementById('qualityChart') as HTMLCanvasElement;
    if (ctx1) {
      this.lineChart = new Chart(ctx1, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Quality Score',
            data: [],
            borderColor: '#0d6efd',
            fill: false,
            tension: 0.2
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'top' } },
          scales: {
            y: { beginAtZero: true, max: 100, title: { display: true, text: 'Quality Score' } }
          }
        }
      });
    }

    const ctx2 = document.getElementById('confidenceChart') as HTMLCanvasElement;
    if (ctx2) {
      this.donutChart = new Chart(ctx2, {
        type: 'doughnut',
        data: {
          labels: ['Pass', 'Fail'],
          datasets: [{
            data: [0, 0],
            backgroundColor: ['#28a745', '#dc3545']
          }]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
      });
    }
  }
}