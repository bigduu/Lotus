import { useState, useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { App as AntApp } from "antd";
import { ImageFile, processImageFiles, cleanupImagePreviews } from "../utils/imageUtils";

interface ControlledImageDraft {
  images: ImageFile[];
  setImages: Dispatch<SetStateAction<ImageFile[]>>;
  clearImages: (imageIds?: readonly string[]) => void;
}

export const useImageHandler = (allowImages: boolean, controlled?: ControlledImageDraft) => {
  // Use context-aware antd message API to avoid dynamic theme warnings
  const { message: appMessage } = AntApp.useApp();
  const [localImages, setLocalImages] = useState<ImageFile[]>([]);
  const images = controlled?.images ?? localImages;
  const setImages = controlled?.setImages ?? setLocalImages;
  const imagesRef = useRef<ImageFile[]>([]);
  imagesRef.current = images;
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [previewImageIndex, setPreviewImageIndex] = useState(0);

  const handleImageFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!allowImages) return;

      try {
        const processedImages = await processImageFiles(files);
        if (processedImages.length > 0) {
          setImages((prevImages) => [...prevImages, ...processedImages]);
          appMessage.success(`Added ${processedImages.length} image(s)`);
        }
      } catch (error) {
        appMessage.error(`Failed to process images: ${error}`);
      }
    },
    [allowImages, appMessage, setImages],
  );

  const handleRemoveImage = useCallback(
    (imageId: string) => {
      const imageToRemove = images.find((img) => img.id === imageId);
      if (imageToRemove) {
        cleanupImagePreviews([imageToRemove]);
      }
      setImages((prevImages) => prevImages.filter((img) => img.id !== imageId));
    },
    [images, setImages],
  );

  const handleImagePreview = useCallback(
    (image: ImageFile) => {
      const index = images.findIndex((img) => img.id === image.id);
      setPreviewImageIndex(index >= 0 ? index : 0);
      setPreviewModalVisible(true);
    },
    [images],
  );

  const clearImages = useCallback(
    (imageIds?: readonly string[]) => {
      if (controlled) {
        controlled.clearImages(imageIds);
        return;
      }

      const currentImages = imagesRef.current;
      const submittedIds = imageIds ? new Set(imageIds) : null;
      const imagesToClear = submittedIds
        ? currentImages.filter((image) => submittedIds.has(image.id))
        : currentImages;
      const imagesToKeep = submittedIds
        ? currentImages.filter((image) => !submittedIds.has(image.id))
        : [];

      cleanupImagePreviews(imagesToClear);
      imagesRef.current = imagesToKeep;
      setLocalImages(imagesToKeep);
    },
    [controlled],
  );

  return {
    images,
    setImages,
    previewModalVisible,
    setPreviewModalVisible,
    previewImageIndex,
    handleImageFiles,
    handleRemoveImage,
    handleImagePreview,
    clearImages,
  };
};
