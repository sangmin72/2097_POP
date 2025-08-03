// Cloudflare Workers Script for Arclead Entertainment Admin System

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        
        // CORS 설정
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400'
        };
        
        // Preflight 요청 처리
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }
        
        try {
            // API 라우팅
            if (path.startsWith('/api/')) {
                const response = await handleApiRequest(request, env);
                
                // CORS 헤더 추가
                Object.keys(corsHeaders).forEach(key => {
                    response.headers.set(key, corsHeaders[key]);
                });
                
                return response;
            }
            
            // 정적 파일 또는 기본 응답
            return new Response('Arclead Entertainment API', { 
                status: 200,
                headers: corsHeaders
            });
            
        } catch (error) {
            console.error('Worker Error:', error);
            return new Response(JSON.stringify({ 
                error: 'Internal Server Error',
                message: error.message 
            }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                }
            });
        }
    }
};

// API 요청 처리
async function handleApiRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    
    // 라우팅
    const routes = {
        // 아티스트 관리
        'GET /api/artists': () => getArtists(env),
        'POST /api/artists': () => createArtist(request, env),
        'GET /api/artists/(.+)': (artistId) => getArtist(artistId, env),
        'PUT /api/artists/(.+)': (artistId) => updateArtist(artistId, request, env),
        'DELETE /api/artists/(.+)': (artistId) => deleteArtist(artistId, env),
        
        // 사진 관리
        'GET /api/artists/(.+)/photos': (artistId) => getArtistPhotos(artistId, env),
        'POST /api/artists/(.+)/photos': (artistId) => uploadPhoto(artistId, request, env),
        'DELETE /api/artists/(.+)/photos/(.+)': (artistId, photoId) => deletePhoto(artistId, photoId, env),
        'PUT /api/artists/(.+)/main-photo': (artistId) => setMainPhoto(artistId, request, env),
        
        // 필모그래피 관리
        'GET /api/artists/(.+)/filmography': (artistId) => getFilmography(artistId, env),
        'PUT /api/artists/(.+)/filmography': (artistId) => updateFilmography(artistId, request, env),
        
        // 데이터 내보내기 (프론트엔드용)
        'GET /api/export/artists': () => exportArtistsData(env),
        'GET /api/export/filmography': () => exportFilmographyData(env)
    };
    
    // 매칭되는 라우트 찾기
    for (const [routePattern, handler] of Object.entries(routes)) {
        const [routeMethod, routePath] = routePattern.split(' ');
        
        if (method === routeMethod) {
            const regex = new RegExp(`^${routePath.replace(/\(.+\)/g, '([^/]+)')}$`);
            const match = path.match(regex);
            
            if (match) {
                const params = match.slice(1);
                return await handler(...params);
            }
        }
    }
    
    return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
    });
}

// 아티스트 목록 조회
async function getArtists(env) {
    try {
        const artistsData = await getR2Object(env.R2_BUCKET, 'data/artists.json');
        const artists = artistsData ? JSON.parse(artistsData) : [];
        
        // 각 아티스트의 대표 사진 URL 추가
        for (let artist of artists) {
            const mainPhotoUrl = await getMainPhotoUrl(artist.id, env);
            if (mainPhotoUrl) {
                artist.mainPhoto = mainPhotoUrl;
            }
        }
        
        return new Response(JSON.stringify(artists), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('getArtists error:', error);
        return new Response(JSON.stringify({ error: 'Failed to get artists' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 아티스트 생성
async function createArtist(request, env) {
    try {
        const artistData = await request.json();
        const artistId = generateId();
        
        const newArtist = {
            id: artistId,
            name: artistData.name,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        // 아티스트 목록 업데이트
        const existingArtists = await getArtists(env).then(res => res.json());
        existingArtists.push(newArtist);
        
        await putR2Object(env.R2_BUCKET, 'data/artists.json', JSON.stringify(existingArtists));
        
        // 필모그래피 초기화
        if (artistData.filmography) {
            await putR2Object(env.R2_BUCKET, `data/filmography/${artistId}.json`, 
                JSON.stringify(artistData.filmography));
        }
        
        return new Response(JSON.stringify({ success: true, artistId }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('createArtist error:', error);
        return new Response(JSON.stringify({ error: 'Failed to create artist' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 특정 아티스트 조회
async function getArtist(artistId, env) {
    try {
        const artistsData = await getR2Object(env.R2_BUCKET, 'data/artists.json');
        const artists = artistsData ? JSON.parse(artistsData) : [];
        
        const artist = artists.find(a => a.id === artistId);
        if (!artist) {
            return new Response(JSON.stringify({ error: 'Artist not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // 필모그래피 로드
        const filmographyData = await getR2Object(env.R2_BUCKET, `data/filmography/${artistId}.json`);
        if (filmographyData) {
            artist.filmography = JSON.parse(filmographyData);
        }
        
        // 대표 사진 URL 추가
        const mainPhotoUrl = await getMainPhotoUrl(artistId, env);
        if (mainPhotoUrl) {
            artist.mainPhoto = mainPhotoUrl;
        }
        
        return new Response(JSON.stringify(artist), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('getArtist error:', error);
        return new Response(JSON.stringify({ error: 'Failed to get artist' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 아티스트 수정
async function updateArtist(artistId, request, env) {
    try {
        const updateData = await request.json();
        
        // 아티스트 목록 업데이트
        const artistsData = await getR2Object(env.R2_BUCKET, 'data/artists.json');
        const artists = artistsData ? JSON.parse(artistsData) : [];
        
        const artistIndex = artists.findIndex(a => a.id === artistId);
        if (artistIndex === -1) {
            return new Response(JSON.stringify({ error: 'Artist not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        artists[artistIndex] = {
            ...artists[artistIndex],
            ...updateData,
            updatedAt: new Date().toISOString()
        };
        
        await putR2Object(env.R2_BUCKET, 'data/artists.json', JSON.stringify(artists));
        
        // 필모그래피 업데이트
        if (updateData.filmography) {
            await putR2Object(env.R2_BUCKET, `data/filmography/${artistId}.json`, 
                JSON.stringify(updateData.filmography));
        }
        
        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('updateArtist error:', error);
        return new Response(JSON.stringify({ error: 'Failed to update artist' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 아티스트 삭제
async function deleteArtist(artistId, env) {
    try {
        // 아티스트 목록에서 제거
        const artistsData = await getR2Object(env.R2_BUCKET, 'data/artists.json');
        const artists = artistsData ? JSON.parse(artistsData) : [];
        
        const filteredArtists = artists.filter(a => a.id !== artistId);
        await putR2Object(env.R2_BUCKET, 'data/artists.json', JSON.stringify(filteredArtists));
        
        // 관련 파일들 삭제
        await deleteR2Object(env.R2_BUCKET, `data/filmography/${artistId}.json`);
        
        // 아티스트 폴더 내 모든 사진 삭제
        try {
            const photosList = await env.R2_BUCKET.list({ prefix: `artists/${artistId}/` });
            for (const object of photosList.objects) {
                await deleteR2Object(env.R2_BUCKET, object.key);
            }
        } catch (deleteError) {
            console.warn('Photo deletion error:', deleteError);
        }
        
        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('deleteArtist error:', error);
        return new Response(JSON.stringify({ error: 'Failed to delete artist' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 아티스트 사진 목록 조회
async function getArtistPhotos(artistId, env) {
    try {
        const photosList = await env.R2_BUCKET.list({ prefix: `artists/${artistId}/photos/` });
        const photos = [];
        
        for (const object of photosList.objects) {
            const photoId = object.key.split('/').pop().split('.')[0];
            const url = await getR2ObjectUrl(env.R2_BUCKET, object.key);
            
            photos.push({
                id: photoId,
                url: url,
                isMain: false // 메타데이터에서 확인 필요
            });
        }
        
        return new Response(JSON.stringify(photos), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('getArtistPhotos error:', error);
        return new Response(JSON.stringify({ error: 'Failed to get photos' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 사진 업로드
async function uploadPhoto(artistId, request, env) {
    try {
        const formData = await request.formData();
        const photo = formData.get('photo');
        
        if (!photo) {
            return new Response(JSON.stringify({ error: 'No photo provided' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const photoId = generateId();
        const fileExtension = photo.name.split('.').pop() || 'jpg';
        const key = `artists/${artistId}/photos/${photoId}.${fileExtension}`;
        
        // R2에 업로드
        await env.R2_BUCKET.put(key, photo.stream(), {
            httpMetadata: {
                contentType: photo.type
            }
        });
        
        const url = await getR2ObjectUrl(env.R2_BUCKET, key);
        
        return new Response(JSON.stringify({
            success: true,
            photoId: photoId,
            url: url
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('uploadPhoto error:', error);
        return new Response(JSON.stringify({ error: 'Failed to upload photo' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 사진 삭제
async function deletePhoto(artistId, photoId, env) {
    try {
        // 해당 photoId의 파일들 찾기
        const photosList = await env.R2_BUCKET.list({ prefix: `artists/${artistId}/photos/${photoId}` });
        
        for (const object of photosList.objects) {
            await deleteR2Object(env.R2_BUCKET, object.key);
        }
        
        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('deletePhoto error:', error);
        return new Response(JSON.stringify({ error: 'Failed to delete photo' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 대표 사진 설정
async function setMainPhoto(artistId, request, env) {
    try {
        const { photoId } = await request.json();
        
        // 기존 대표 사진 파일들 찾기
        const photosList = await env.R2_BUCKET.list({ prefix: `artists/${artistId}/photos/${photoId}` });
        
        if (photosList.objects.length === 0) {
            return new Response(JSON.stringify({ error: 'Photo not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const sourceKey = photosList.objects[0].key;
        const sourceObject = await env.R2_BUCKET.get(sourceKey);
        
        if (!sourceObject) {
            return new Response(JSON.stringify({ error: 'Photo not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // 대표 사진으로 복사
        const mainPhotoKey = `artists/${artistId}/main.jpg`;
        await env.R2_BUCKET.put(mainPhotoKey, sourceObject.body, {
            httpMetadata: sourceObject.httpMetadata
        });
        
        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('setMainPhoto error:', error);
        return new Response(JSON.stringify({ error: 'Failed to set main photo' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 필모그래피 조회
async function getFilmography(artistId, env) {
    try {
        const filmographyData = await getR2Object(env.R2_BUCKET, `data/filmography/${artistId}.json`);
        const filmography = filmographyData ? JSON.parse(filmographyData) : {
            dramas: [],
            movies: [],
            commercials: []
        };
        
        return new Response(JSON.stringify(filmography), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('getFilmography error:', error);
        return new Response(JSON.stringify({ error: 'Failed to get filmography' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 필모그래피 업데이트
async function updateFilmography(artistId, request, env) {
    try {
        const filmographyData = await request.json();
        
        await putR2Object(env.R2_BUCKET, `data/filmography/${artistId}.json`, 
            JSON.stringify(filmographyData));
        
        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('updateFilmography error:', error);
        return new Response(JSON.stringify({ error: 'Failed to update filmography' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 프론트엔드용 아티스트 데이터 내보내기
async function exportArtistsData(env) {
    try {
        const artistsData = await getR2Object(env.R2_BUCKET, 'data/artists.json');
        const artists = artistsData ? JSON.parse(artistsData) : [];
        
        const exportData = {};
        
        for (const artist of artists) {
            // 필모그래피 로드
            const filmographyData = await getR2Object(env.R2_BUCKET, `data/filmography/${artist.id}.json`);
            const filmography = filmographyData ? JSON.parse(filmographyData) : {
                dramas: [],
                movies: [],
                commercials: []
            };
            
            // 대표 사진 URL
            const mainPhotoUrl = await getMainPhotoUrl(artist.id, env);
            
            exportData[artist.name] = {
                title: `${artist.name} - 아크리드 아티스트`,
                filmography: filmography,
                mainPhoto: mainPhotoUrl
            };
        }
        
        return new Response(JSON.stringify(exportData), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('exportArtistsData error:', error);
        return new Response(JSON.stringify({ error: 'Failed to export artists data' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 프론트엔드용 필모그래피 데이터 내보내기
async function exportFilmographyData(env) {
    try {
        const artistsData = await getR2Object(env.R2_BUCKET, 'data/artists.json');
        const artists = artistsData ? JSON.parse(artistsData) : [];
        
        const filmographyData = {};
        
        for (const artist of artists) {
            const data = await getR2Object(env.R2_BUCKET, `data/filmography/${artist.id}.json`);
            if (data) {
                filmographyData[artist.name] = JSON.parse(data);
            }
        }
        
        return new Response(JSON.stringify(filmographyData), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('exportFilmographyData error:', error);
        return new Response(JSON.stringify({ error: 'Failed to export filmography data' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 유틸리티 함수들

// R2 객체 조회
async function getR2Object(bucket, key) {
    try {
        const object = await bucket.get(key);
        return object ? await object.text() : null;
    } catch (error) {
        console.error(`getR2Object error for key ${key}:`, error);
        return null;
    }
}

// R2 객체 저장
async function putR2Object(bucket, key, data) {
    await bucket.put(key, data, {
        httpMetadata: {
            contentType: 'application/json'
        }
    });
}

// R2 객체 삭제
async function deleteR2Object(bucket, key) {
    await bucket.delete(key);
}

// R2 객체 URL 생성 (presigned URL 또는 public URL)
async function getR2ObjectUrl(bucket, key) {
    // Cloudflare R2의 public URL 형식
    // 실제 환경에서는 bucket의 public URL 도메인을 사용해야 함
    return `https://your-r2-domain.com/${key}`;
}

// 대표 사진 URL 조회
async function getMainPhotoUrl(artistId, env) {
    try {
        const mainPhotoKey = `artists/${artistId}/main.jpg`;
        const mainPhoto = await env.R2_BUCKET.get(mainPhotoKey);
        
        if (mainPhoto) {
            return await getR2ObjectUrl(env.R2_BUCKET, mainPhotoKey);
        }
        
        return null;
    } catch (error) {
        console.error('getMainPhotoUrl error:', error);
        return null;
    }
}

// 고유 ID 생성
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}