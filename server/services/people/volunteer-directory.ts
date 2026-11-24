/**
 * Volunteers directory built from `people` + `volunteer_profiles`
 * (people/places rebuild, step 7c-1). Read-only: volunteer details come from
 * the volunteer sheet, and people are edited on the People admin page.
 */
import { sqlClient } from '../../db';

export interface DirectoryVolunteer {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  isVolunteer: boolean;
  isDriver: boolean;
  isHost: boolean;
  availabilityStatus: 'active' | 'temporarily_unavailable' | 'inactive' | null;
  onRecruitmentList: boolean | null;
  getsRecruitmentEmails: boolean;
  location: string | null;
  experienceLevel: string | null;
  trainingCompleted: boolean | null;
  onSheet: boolean;
  sheetNotes: string | null;
  notes: string | null;
}

/**
 * Everyone who is a volunteer now, plus anyone with volunteer details (so an
 * Inactive volunteer from the sheet still shows under "Inactive").
 * Recruitment emails go to people on the list AND active (docs/data-model.md).
 */
export async function listDirectoryVolunteers(opts: { includeNotes: boolean }): Promise<DirectoryVolunteer[]> {
  const rows = await sqlClient(
    `SELECT p.id, p.first_name, p.last_name, p.email, p.phone, p.is_volunteer, p.is_driver, p.is_host, p.notes,
            v.availability_status, v.on_recruitment_list, v.location, v.experience_level,
            v.training_completed, v.on_sheet, v.sheet_notes
       FROM people p
       LEFT JOIN volunteer_profiles v ON v.person_id = p.id
      WHERE p.is_active AND (p.is_volunteer OR v.id IS NOT NULL)
      ORDER BY lower(p.last_name), lower(p.first_name)`,
    []
  );
  return rows.map((r: any) => ({
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    phone: r.phone,
    isVolunteer: r.is_volunteer,
    isDriver: r.is_driver,
    isHost: r.is_host,
    availabilityStatus: r.availability_status ?? null,
    onRecruitmentList: r.on_recruitment_list ?? null,
    getsRecruitmentEmails: r.is_volunteer && r.on_recruitment_list === true && r.availability_status === 'active',
    location: r.location ?? null,
    experienceLevel: r.experience_level ?? null,
    trainingCompleted: r.training_completed ?? null,
    onSheet: r.on_sheet === true,
    sheetNotes: opts.includeNotes ? r.sheet_notes ?? null : null,
    notes: opts.includeNotes ? r.notes ?? null : null,
  }));
}
