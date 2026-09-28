export type WorkDriveUploadResult = {
  id: string;
  name: string;
  folderId: string;
  rootFolderId: string;
  size: number;
};

export function workDriveCatalogMetadata(uploaded: WorkDriveUploadResult, originalFilename: string, userId: string, uploadedAt = new Date()) {
  return {
    sourceType: "workdrive" as const,
    sourcePdfUrl: "",
    workdriveFileId: uploaded.id,
    workdriveFileName: uploaded.name,
    workdriveFolderId: uploaded.folderId,
    workdriveRootFolderId: uploaded.rootFolderId,
    sourceSize: uploaded.size,
    originalFilename,
    uploadedAt,
    uploadedBy: userId,
  };
}
