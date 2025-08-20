import { Routes } from '@angular/router';
import { DatauploadComponent } from './pages/dataupload/dataupload';
import { DaterangeComponent } from './pages/daterange/daterange';
import { ModelTraining } from './pages/modeltraining/modeltraining';
import { SimulationComponent } from './pages/simulation/simulation';

export const routes: Routes = [
  { path: '', redirectTo: 'upload', pathMatch: 'full' },
  { path: 'upload', component: DatauploadComponent },
  { path: 'daterange', component: DaterangeComponent },
  { path: 'modeltraining', component: ModelTraining },
  { path: 'simulation', component: SimulationComponent }  
];
