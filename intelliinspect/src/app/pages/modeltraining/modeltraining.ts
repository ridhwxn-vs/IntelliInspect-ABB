import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

@Component({
  selector: 'app-training',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './modeltraining.html',
  styleUrls: ['./modeltraining.css']
})
export class ModelTraining {
  trained: boolean = false;

  accuracy: number = 94.2;
  precision: number = 92.8;
  recall: number = 91.5;
  f1score: number = 92.1;

  trainModel() {
    this.trained = true;
    this.renderCharts();
  }

  private renderCharts() {

    const ctx1 = document.getElementById('trainingChart') as HTMLCanvasElement;
    if (ctx1) {
      new Chart(ctx1, {
        type: 'line',
        data: {
          labels: Array.from({ length: 20 }, (_, i) => `Epoch ${i + 1}`),
          datasets: [
            {
              label: 'Training Accuracy',
              data: [70, 75, 78, 80, 83, 85, 86, 87, 88, 89, 90, 91, 91.5, 92, 92.5, 93, 93.5, 94, 94.2, 94.2],
              borderColor: 'green',
              fill: false,
              tension: 0.2
            },
            {
              label: 'Training Loss',
              data: [1, 0.9, 0.8, 0.7, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.22, 0.20, 0.18, 0.15, 0.12, 0.1, 0.09, 0.08],
              borderColor: 'red',
              fill: false,
              tension: 0.2,
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          responsive: true,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'top' } },
          scales: {
            y: {
              beginAtZero: true,
              title: { display: true, text: 'Accuracy (%)' },
              stacked: false   
            },
            y1: {
              beginAtZero: true,
              position: 'right',
              title: { display: true, text: 'Loss' },
              grid: { drawOnChartArea: false },
              stacked: false   
            }
          }
        }
      });
    }

    const ctx2 = document.getElementById('confusionChart') as HTMLCanvasElement;
    if (ctx2) {
      new Chart(ctx2, {
        type: 'doughnut',
        data: {
          labels: ['True Positive', 'True Negative', 'False Positive', 'False Negative'],
          datasets: [{
            data: [500, 400, 50, 30], 
            backgroundColor: ['#28a745', '#0d6efd', '#fd7e14', '#dc3545']
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'bottom' }
          }
        }
      });
    }
  }
}
