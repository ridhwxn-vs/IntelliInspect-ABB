import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Chart, registerables } from 'chart.js';
import { ApiService, TrainResponse } from '../../api.service';

Chart.register(...registerables);

@Component({
  selector: 'app-training',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './modeltraining.html',
  styleUrls: ['./modeltraining.css']
})
export class ModelTraining {
  trained = false;
  loading = false;
  errorMsg = '';

  accuracy = 0;
  precision = 0;
  recall = 0;
  f1score = 0;

  private lineChart: Chart | null = null;
  private donutChart: Chart | null = null;

  constructor(private api: ApiService) {}

  // NEW: clean up charts if user navigates away
  ngOnDestroy() {
    this.lineChart?.destroy();
    this.donutChart?.destroy();
  }

  private pad(n: number) { return String(n).padStart(2, '0'); }

  private fmtLocal(d: Date): string {
    return `${d.getFullYear()}-${this.pad(d.getMonth()+1)}-${this.pad(d.getDate())} ` +
           `${this.pad(d.getHours())}:${this.pad(d.getMinutes())}:${this.pad(d.getSeconds())}`;
  }

  private toYYYYmmddHHMMSS(input: any): string {
    if (!input) return '';

    if (typeof input === 'string') {
      let s = input.trim();
      s = s.replace('T', ' ');
      if (s.endsWith('Z')) {
        const d = new Date(input);
        return this.fmtLocal(d);
      }
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return `${s}:00`;
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+$/.test(s)) s = s.split('.')[0];
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;

      const d = new Date(s);
      if (!isNaN(d.getTime())) return this.fmtLocal(d);
      return '';
    }
    if (input instanceof Date) return this.fmtLocal(input);
    return '';
  }

  trainModel() {
    this.errorMsg = '';
    const fileKey = this.api.getCurrentFileKey();
    if (!fileKey) {
      this.errorMsg = 'Missing fileKey. Please upload a dataset again.';
      return;
    }

    let ranges: any = {};
    try { ranges = JSON.parse(sessionStorage.getItem('miniml:ranges') || '{}'); } catch {}
    let { trainStart, trainEnd, testStart, testEnd } = ranges;

    trainStart = this.toYYYYmmddHHMMSS(trainStart);
    trainEnd   = this.toYYYYmmddHHMMSS(trainEnd);
    testStart  = this.toYYYYmmddHHMMSS(testStart);
    testEnd    = this.toYYYYmmddHHMMSS(testEnd);

    if (!trainStart || !trainEnd || !testStart || !testEnd) {
      this.errorMsg = 'Invalid date ranges. Please reselect Step 2 ranges.';
      console.error('Bad ranges:', { trainStart, trainEnd, testStart, testEnd, raw: ranges });
      return;
    }

    this.loading = true;
    this.api.trainModel({ fileKey, trainStart, trainEnd, testStart, testEnd })
      .subscribe({
        next: (res: TrainResponse) => {
          this.loading = false;
          this.accuracy = res.accuracy;
          this.precision = res.precision;
          this.recall = res.recall;
          this.f1score = res.f1score;
          this.trained = true;

          setTimeout(() => {
            this.renderLine(res.history.epochs, res.history.train_accuracy, res.history.train_logloss);
            this.renderDonut(res.confusion.tp, res.confusion.tn, res.confusion.fp, res.confusion.fn);
          }, 0);
        },
        error: async (err: any) => {
          console.error('HttpErrorResponse:', err);

          if (err?.error instanceof Blob) {
            const text = await err.error.text();
            console.error('Error blob text:', text);
            alert(text);
            return;
          }
          if (typeof err?.error === 'string') {
            console.error('Error string:', err.error);
            alert(err.error);
            return;
          }

          const detail = err?.error?.detail;
          const msg    = err?.error?.message;
          const stderr = err?.error?.stderr;
          const stdout = err?.error?.stdout;
          const script = err?.error?.script;
          const pyExe  = err?.error?.pyExe;

          console.error('Train failed:', { detail, msg, stderr, stdout, script, pyExe });
          alert(detail || msg || 'Server error');
          this.loading = false; // NEW: ensure spinner stops on error
        }
      });
  }

  private renderLine(epochs: number[], trainAcc: number[], trainLogloss: number[]) {
    const ctx = document.getElementById('trainingChart') as HTMLCanvasElement | null;
    if (!ctx) return;

    this.lineChart?.destroy();

    // If API returned a single point, make sure it’s visible (bigger point)
    const accPointRadius  = trainAcc.length <= 1 ? 3 : 0;
    const lossPointRadius = trainLogloss.length <= 1 ? 3 : 0;

    this.lineChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: epochs.map(e => `Epoch ${e}`),
        datasets: [
          {
            label: 'Training Accuracy (%)',
            data: trainAcc,
            borderColor: 'green',
            yAxisID: 'y',
            tension: 0.2,
            pointRadius: accPointRadius
          },
          {
            label: 'Training Logloss',
            data: trainLogloss,
            borderColor: 'red',
            yAxisID: 'y1',
            tension: 0.2,
            pointRadius: lossPointRadius
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,          // NEW: ensure it fills the fixed-height container
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'top' } },
        scales: {
          y:  { beginAtZero: true, title: { display: true, text: 'Accuracy (%)' }, min: 0, max: 100 },
          y1: { beginAtZero: true, position: 'right', title: { display: true, text: 'Logloss' }, grid: { drawOnChartArea: false } }
        }
      }
    });
  }

  private renderDonut(tp: number, tn: number, fp: number, fn: number) {
    const ctx = document.getElementById('confusionChart') as HTMLCanvasElement | null;
    if (!ctx) return;

    this.donutChart?.destroy();

    this.donutChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['True Positive', 'True Negative', 'False Positive', 'False Negative'],
        datasets: [{
          data: [tp, tn, fp, fn],
          backgroundColor: ['#28a745', '#0d6efd', '#fd7e14', '#dc3545']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,         // NEW: fills container height
        plugins: { legend: { position: 'bottom' } },
        cutout: '55%'                        // NEW: cleaner “donut” look
      }
    });
  }
}
