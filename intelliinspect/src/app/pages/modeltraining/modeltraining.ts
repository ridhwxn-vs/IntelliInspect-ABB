import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
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

  private pad(n: number) { return String(n).padStart(2, '0'); }

  private fmtLocal(d: Date): string {
    return `${d.getFullYear()}-${this.pad(d.getMonth()+1)}-${this.pad(d.getDate())} ` +
           `${this.pad(d.getHours())}:${this.pad(d.getMinutes())}:${this.pad(d.getSeconds())}`;
  }

  private toYYYYmmddHHMMSS(input: any): string {
    if (!input) return '';

    // If already in "yyyy-MM-dd HH:mm:ss", keep it
    if (typeof input === 'string') {
      let s = input.trim();

      // Replace 'T' with space if present
      s = s.replace('T', ' ');

      // Remove trailing 'Z' (ISO UTC) and convert via Date to local
      if (s.endsWith('Z')) {
        const d = new Date(input);
        return this.fmtLocal(d);
      }

      // Add seconds if only yyyy-MM-dd HH:mm
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return `${s}:00`;

      // Trim milliseconds if any: yyyy-MM-dd HH:mm:ss.sss
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+$/.test(s)) {
        s = s.split('.')[0];
      }

      // If it now matches the strict shape, return it
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;

      // Fallback: let Date parse it and format
      const d = new Date(s);
      if (!isNaN(d.getTime())) return this.fmtLocal(d);
      return ''; // invalid
    }

    // Handle Date object
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

    // ranges from sessionStorage (saved in Step 2)
    let ranges: any = {};
    try { ranges = JSON.parse(sessionStorage.getItem('miniml:ranges') || '{}'); } catch {}
    let { trainStart, trainEnd, testStart, testEnd } = ranges;

    // ✅ Normalize to "yyyy-MM-dd HH:mm:ss" before POST
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
          this.renderLine(res.history.epochs, res.history.train_accuracy, res.history.train_logloss);
          this.renderDonut(res.confusion.tp, res.confusion.tn, res.confusion.fp, res.confusion.fn);
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
        }
      });
  }

  private renderLine(epochs: number[], trainAcc: number[], trainLogloss: number[]) {
    const ctx = document.getElementById('trainingChart') as HTMLCanvasElement;
    if (!ctx) return;

    if (this.lineChart) this.lineChart.destroy();

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
            tension: 0.2
          },
          {
            label: 'Training Logloss',
            data: trainLogloss,
            borderColor: 'red',
            yAxisID: 'y1',
            tension: 0.2
          }
        ]
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'top' } },
        scales: {
          y:  { beginAtZero: true, title: { display: true, text: 'Accuracy (%)' } },
          y1: { beginAtZero: true, position: 'right', title: { display: true, text: 'Logloss' }, grid: { drawOnChartArea: false } }
        }
      }
    });
  }

  private renderDonut(tp: number, tn: number, fp: number, fn: number) {
    const ctx = document.getElementById('confusionChart') as HTMLCanvasElement;
    if (!ctx) return;

    if (this.donutChart) this.donutChart.destroy();

    this.donutChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['True Positive', 'True Negative', 'False Positive', 'False Negative'],
        datasets: [{
          data: [tp, tn, fp, fn],
          backgroundColor: ['#28a745', '#0d6efd', '#fd7e14', '#dc3545']
        }]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });
  }
}
