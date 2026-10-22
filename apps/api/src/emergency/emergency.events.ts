export const EmergencyEvents = {
  TRIGGERED: 'emergency.triggered',
} as const;

export interface EmergencyTriggeredPayload {
  incidentId: string;
  operatorUserIds: string[];
  affectedParentUserIds: string[];
  note: string | null;
}
