import mongoose from "mongoose";
import Folder from "../models/Folder";
import Link from "../models/Link";
import Profile from "../models/Profile";
import User from "../models/User";

const getOwnedFolderIds = async (userId: string) => {
  const folders = await Folder.find({ owner: userId }).select("_id");

  return folders.map((folder) => folder._id);
};

export const deleteAccountById = async (userId: string) => {
  if (!mongoose.Types.ObjectId.isValid(userId)) return false;

  const user = await User.findById(userId).select("_id");
  if (!user) return false;

  const ownedFolderIds = await getOwnedFolderIds(userId);
  const unassignFolderLinks = ownedFolderIds.length
    ? Link.updateMany(
        { folderId: { $in: ownedFolderIds }, owner: { $ne: userId } },
        { $set: { folderId: null } },
      )
    : Promise.resolve();

  await Promise.all([
    Link.deleteMany({ owner: userId }),
    unassignFolderLinks,
    Folder.deleteMany({ owner: userId }),
    Folder.updateMany(
      { collaborators: userId },
      { $pull: { collaborators: userId } },
    ),
    Profile.deleteOne({ owner: userId }),
  ]);

  await User.findByIdAndDelete(userId);

  return true;
};
