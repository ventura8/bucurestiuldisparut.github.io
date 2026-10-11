/** The admins/{uid} documents: an admin's custom claim counts only while this document exists. */
export interface AdminDirectory {
    isAdmin(uid: string): Promise<boolean>;
}
