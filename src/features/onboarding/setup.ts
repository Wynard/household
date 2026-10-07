import { config } from '../../config';
import { DriveAdapter, createFolder } from '../../storage/drive';
import type { GoogleAuth } from '../../auth/google';
import { budgetFileName, emptyFile, usageFileName, type DataFile } from '../../domain/files';
import { DEFAULT_STORES, MEMBER_COLORS } from '../../domain/defaults';
import { yearOfDate, todayISO } from '../../domain/dates';
import type { HouseholdFile, Member } from '../../domain/schemas';

export interface CreateForm {
  myName: string;
  partnerName: string;
  partnerEmail: string;
  monthlyTarget: number;
  potNow: number;
}

/**
 * First person: creates the "Household Data" folder and every data file in it,
 * then household.json with the Drive ID of each file (so the partner's phone
 * can tell which files it still needs access to).
 */
export async function createHousehold(auth: GoogleAuth, form: CreateForm): Promise<string> {
  const me = auth.profile!;
  const tmp = new DriveAdapter(auth, '');
  const folder = await createFolder(tmp, config.folderName);
  const drive = new DriveAdapter(auth, folder.id);
  const year = yearOfDate(todayISO());
  const ids: Record<string, string> = {};
  const files: DataFile[] = [
    'items',
    'recipes',
    'plan',
    'shopping',
    budgetFileName(year),
    usageFileName(year),
  ];
  for (const f of files) {
    const data = emptyFile(
      f,
      me.email,
      f === budgetFileName(year) ? { openingBalance: Math.round(form.potNow * 100) / 100 } : {},
    );
    const created = await drive.createFile(
      `${f}.json`,
      'application/json',
      new Blob([JSON.stringify(data)], { type: 'application/json' }),
      folder.id,
    );
    ids[f] = created.id;
  }
  const members: Member[] = [
    { email: me.email, name: form.myName.trim() || me.name, color: MEMBER_COLORS[0] },
  ];
  if (form.partnerEmail.trim())
    members.push({
      email: form.partnerEmail.trim().toLowerCase(),
      name: form.partnerName.trim() || 'Partner',
      color: MEMBER_COLORS[1],
    });
  const household: HouseholdFile = {
    ...(emptyFile('household', me.email) as HouseholdFile),
    members,
    monthlyTarget: form.monthlyTarget,
    stores: DEFAULT_STORES,
    years: [year],
    fileIds: ids,
  };
  const h = await drive.createFile(
    'household.json',
    'application/json',
    new Blob([JSON.stringify(household)], { type: 'application/json' }),
    folder.id,
  );
  // record household.json's own ID too
  await drive.refreshIndex();
  const cur = await drive.readJson<HouseholdFile>('household');
  await drive.writeJson('household', { ...cur.data, fileIds: { ...ids, household: h.id } }, cur.version);
  return folder.id;
}

/** Which data files this phone still can't open (after joining). */
export async function missingFiles(drive: DriveAdapter): Promise<string[]> {
  await drive.refreshIndex();
  try {
    const h = await drive.readJson<HouseholdFile>('household');
    drive.setKnownIds(h.data.fileIds);
    return drive.missingAccess();
  } catch {
    return ['household'];
  }
}
