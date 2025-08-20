import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
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
  total = 0;
  pass = 0;
  fail = 0;
  avgConf = 0;
  rows: PredictionRow[] = [];

  private lineChart: Chart | null = null;
  private donutChart: Chart | null = null;
  private intervalId: any;
  private totalRecords = 0; // how many records to simulate

  constructor(private rangeService: RangeService) {}

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

    this.running = true;
    this.reset();

    // ✅ Calculate total "records" from simStart–simEnd
    const start = new Date(this.rangeService.simStart);
    const end = new Date(this.rangeService.simEnd);
    this.totalRecords = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));

    // Init charts
    this.initCharts();

    let sampleId = 1;
    this.intervalId = setInterval(() => {
      if (this.total >= this.totalRecords) {
        this.stopSimulation();
        return;
      }

      // Random prediction
      const prediction = Math.random() > 0.3 ? 'Pass' : 'Fail';
      const confidence = Math.floor(Math.random() * 30) + 70; // 70–100
      const temperature = 20 + Math.random() * 5;
      const pressure = 1000 + Math.random() * 20;
      const humidity = 40 + Math.random() * 10;

      this.total++;
      if (prediction === 'Pass') this.pass++; else this.fail++;
      this.avgConf = ((this.avgConf * (this.total - 1)) + confidence) / this.total;

      // Simulated timestamp (1 day per tick)
      const now = new Date(start.getTime() + this.total * 24 * 60 * 60 * 1000).toLocaleDateString();

      // Update table
      this.rows.unshift({
        time: now,
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
        this.lineChart.data.labels?.push(now);
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
    }, 500); // each half second = 1 day of simulation
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
    // Line chart
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

    // Donut chart
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
