import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Modeltraining } from './modeltraining';

describe('Modeltraining', () => {
  let component: Modeltraining;
  let fixture: ComponentFixture<Modeltraining>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Modeltraining]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Modeltraining);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
