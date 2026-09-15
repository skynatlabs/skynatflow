/*
  Warnings:

  - You are about to drop the column `colorSkin` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "colorSkin",
ADD COLUMN     "accentPalette" TEXT;
