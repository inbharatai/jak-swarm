import { Industry, RiskLevel, ToolCategory } from '@jak-swarm/shared';
import type { IndustryPack } from '@jak-swarm/shared';

export const educationPack: IndustryPack = {
  industry: Industry.EDUCATION,
  displayName: 'Education Administration',
  description:
    'Workflow automation for educational institutions including student enrollment, course management, grading assistance, parent communication, scheduling, and compliance reporting. Subject to FERPA and student privacy regulations.',
  subFunctions: [
    'Student Enrollment',
    'Course Management',
    'Grading Assistance',
    'Parent Communication',
    'Scheduling',
    'Compliance Reporting',
    'Financial Aid Processing',
    'Academic Advising',
  ],
  defaultWorkflows: [
    'process_enrollment_application',
    'send_grade_notifications',
    'schedule_advising_appointments',
    'generate_compliance_report',
    'parent_communication_batch',
    'course_waitlist_management',
  ],
  allowedTools: [
    ToolCategory.EMAIL,
    ToolCategory.CALENDAR,
    ToolCategory.DOCUMENT,
    ToolCategory.KNOWLEDGE,
    ToolCategory.STORAGE,
    ToolCategory.SPREADSHEET,
  ],
  restrictedTools: [ToolCategory.WEBHOOK, ToolCategory.BROWSER],
  complianceNotes: [
    'FERPA: Student education records are protected — only share with authorized parties',
    'Parental rights transfer to student at age 18 or upon college enrollment',
    'Directory information can be shared unless student has opted out',
    'Records requests from law enforcement require proper legal process',
    'Student financial information protected under GLBA for eligible institutions',
    'Accessibility requirements: all automated communications must be accessible (WCAG 2.1)',
  ],
  agentPromptSupplement: `EDUCATION COMPLIANCE CONTEXT:
You are operating within a FERPA-governed educational institution.

CRITICAL RULES:
1. FERPA PROTECTION: Student education records (grades, transcripts, enrollment status, financial aid, disciplinary records) are protected. Never share with unauthorized third parties.
2. PARENTAL ACCESS: For students under 18, parents may have access rights. For students 18+, parental access requires student written consent unless financial dependency exception applies.
3. DIRECTORY INFORMATION: Name, address, phone, email, enrollment status, degree program may be releasable as directory info unless student has opted out. Always check opt-out status.
4. MINOR STUDENTS: Extra protections apply for students under 18. Communications about minors must go through authorized guardians.
5. ACADEMIC INTEGRITY: When assisting with grading or assessments, flag any potential academic dishonesty patterns for human review. Do not make final grade decisions.
6. ACCESSIBILITY: All communications and documents must meet accessibility standards.

When communicating with parents about students over 18, always verify consent before sharing any non-directory information.`,
  recommendedApprovalThreshold: RiskLevel.MEDIUM,
  defaultKPITemplates: [
    'enrollment_conversion_rate',
    'advising_appointment_utilization',
    'grade_submission_timeliness',
    'parent_communication_response_rate',
    'compliance_report_completion',
  ],
  policyOverlays: [
    {
      name: 'FERPA Student Record Protection',
      rule: 'Student education records must not be shared with unauthorized parties. Verify recipient authorization before any communication containing student data.',
      enforcement: 'BLOCK',
      appliesTo: [ToolCategory.EMAIL, ToolCategory.MESSAGING, ToolCategory.WEBHOOK],
    },
    {
      name: 'Minor Student Safeguard',
      rule: 'Communications involving students under 18 must route through verified guardians',
      enforcement: 'WARN',
      appliesTo: [ToolCategory.EMAIL, ToolCategory.MESSAGING],
    },
  ],
};
