import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

import type { PlaceMasterSummary } from '@/src/lib/places/place-master-api';

/** Supabase `places` 스냅샷 — 장소 검색 로컬 히트·오프라인용 */
export class PlaceCache extends Model {
  static table = 'places_cache' as const;

  @field('place_key') placeKey!: string;
  @field('server_place_id') serverPlaceId!: string | null;
  @field('place_name') placeName!: string;
  @field('road_address') roadAddress!: string;
  @field('category') category!: string | null;
  @field('latitude') latitude!: number | null;
  @field('longitude') longitude!: number | null;
  @field('preferred_photo_media_url') preferredPhotoMediaUrl!: string | null;
  @field('naver_place_link') naverPlaceLink!: string | null;
  @field('average_rating') averageRating!: number;
  @field('review_count') reviewCount!: number;
  @field('synced_at_ms') syncedAtMs!: number;

  toSummary(): PlaceMasterSummary {
    return {
      placeKey: this.placeKey,
      id: this.serverPlaceId ?? '',
      placeName: this.placeName,
      averageRating: this.averageRating,
      reviewCount: this.reviewCount,
      topKeywords: [],
      category: this.category,
      roadAddress: this.roadAddress,
      preferredPhotoMediaUrl: this.preferredPhotoMediaUrl,
      naverPlaceLink: this.naverPlaceLink,
      latitude: this.latitude,
      longitude: this.longitude,
    };
  }

  updateFromSummary(summary: PlaceMasterSummary, syncedAtMs: number): void {
    this.placeKey = summary.placeKey;
    this.serverPlaceId = summary.id || null;
    this.placeName = summary.placeName;
    this.roadAddress = summary.roadAddress;
    this.category = summary.category;
    this.latitude = summary.latitude;
    this.longitude = summary.longitude;
    this.preferredPhotoMediaUrl = summary.preferredPhotoMediaUrl;
    this.naverPlaceLink = summary.naverPlaceLink;
    this.averageRating = summary.averageRating;
    this.reviewCount = summary.reviewCount;
    this.syncedAtMs = syncedAtMs;
  }
}
