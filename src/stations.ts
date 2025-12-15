export interface Station {
    id: string;
    label: string;
    description: string;
    url: string;
    icon: string;
    gradient: string;
}

export const STATIONS: Station[] = [
    { 
        id: 'nightride',
        label: "Nightride FM", 
        description: "Synthwave Classics", 
        url: "http://stream.nightride.fm/nightride.m4a",
        icon: "radio-tower",
        gradient: "linear-gradient(135deg, #00f3ff 0%, #bd00ff 100%)"
    },
    { 
        id: 'chillsynth',
        label: "Chillsynth", 
        description: "Lo-Fi & Downtempo", 
        url: "http://stream.nightride.fm/chillsynth.m4a",
        icon: "heart",
        gradient: "linear-gradient(135deg, #ff9a9e 0%, #fecfef 99%, #fecfef 100%)"
    },
    { 
        id: 'datawave',
        label: "Datawave", 
        description: "Cyberpunk Focus", 
        url: "http://stream.nightride.fm/datawave.m4a",
        icon: "terminal",
        gradient: "linear-gradient(135deg, #0ba360 0%, #3cba92 100%)"
    },
    { 
        id: 'spacesynth',
        label: "Spacesynth", 
        description: "Sci-Fi Energy", 
        url: "http://stream.nightride.fm/spacesynth.m4a",
        icon: "rocket",
        gradient: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)"
    },
    { 
        id: 'darksynth',
        label: "Darksynth", 
        description: "Industrial Aggressive", 
        url: "http://stream.nightride.fm/darksynth.m4a",
        icon: "beaker",
        gradient: "linear-gradient(135deg, #434343 0%, #000000 100%)"
    },
    { 
        id: 'ebsm',
        label: "EBSM", 
        description: "Dark Club & EBM", 
        url: "http://stream.nightride.fm/ebsm.m4a",
        icon: "zap",
        gradient: "linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)"
    },
    { 
        id: 'horrorsynth',
        label: "Horror", 
        description: "Spooky Ambient", 
        url: "http://stream.nightride.fm/horrorsynth.m4a",
        icon: "bug",
        gradient: "linear-gradient(135deg, #240b36 0%, #c31432 100%)"
    },
    { 
        id: 'rekt',
        label: "Rekt FM", 
        description: "Drum & Bass", 
        url: "http://stream.nightride.fm/rekt.m4a",
        icon: "flame",
        gradient: "linear-gradient(135deg, #f83600 0%, #f9d423 100%)"
    }
];