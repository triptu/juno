/**
 * Home's pictures (SPEC 12, "A picture" and "Pictures and the gallery").
 * The catalog is bundled in the renderer; the engine only keeps the image
 * files on disk, under `<userData>/pictures/`, where main serves them as
 * `juno://pictures/<id>-<size>.webp`.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

export const PictureSize = Schema.Literals(['small', 'large'])
export type PictureSize = typeof PictureSize.Type

/**
 * Downloads one size of a picture to disk unless it is there, and says
 * whether it is there now. False for an id that is not a picture's file
 * name, and when the download fails; the next call tries again.
 */
export const picturesFetch = Rpc.make('pictures.fetch', { payload: { id: Schema.String, size: PictureSize }, success: Schema.Boolean })

/** The pictures whose file of this size is on disk, for the gallery's first frame. */
export const picturesOnDisk = Rpc.make('pictures.onDisk', { payload: { size: PictureSize }, success: Schema.Array(Schema.String) })

export const PicturesRoutes = RpcGroup.make(picturesFetch, picturesOnDisk)
