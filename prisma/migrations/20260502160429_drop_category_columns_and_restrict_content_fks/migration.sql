-- DropForeignKey
ALTER TABLE "courses" DROP CONSTRAINT "courses_pathId_fkey";
-- DropForeignKey
ALTER TABLE "paths" DROP CONSTRAINT "paths_categoryId_fkey";
-- AlterTable
ALTER TABLE "categories" DROP COLUMN "description",
DROP COLUMN "icon";
-- AddForeignKey
ALTER TABLE "paths" ADD CONSTRAINT "paths_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_pathId_fkey" FOREIGN KEY ("pathId") REFERENCES "paths"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
