require([
  "esri/Map",
  "esri/views/SceneView",
  "esri/layers/TileLayer",
  "esri/views/3d/externalRenderers"
], function(Map, SceneView, TileLayer, externalRenderers) {
  const map = new Map({
    basemap: {
      baseLayers: [
        new TileLayer({
          url:
            "https://map.geoq.cn/arcgis/rest/services/ChinaOnlineCommunity/MapServer"
        })
      ]
    }
  });

  const view = new SceneView({
    container: "viewDiv",
    map: map,
    viewingMode: "local",
    camera: {
      heading: 0,
      tilt: 70,
      position: {
        latitude: 39.569704,
        longitude: 116.433877,
        z: 13000
      }
    }
  });
  view.environment.lighting.cameraTrackingEnabled = false;

  const issExternalRenderer = {
    renderer: null,
    camera: null,
    scene: null,

    ambient: null,
    sun: null,

    car: null,
    carScale: 40000,
    carMaterial: new THREE.MeshLambertMaterial({ color: 0xe03110 }),

    cameraPositionInitialized: false,
    //轨迹点列表
    positionHistory: [],
    //以经过的点列表
    estHistory: [],

    setup: function(context) {
      this.renderer = new THREE.WebGLRenderer({
        context: context.gl,
        premultipliedAlpha: false
      });
      this.renderer.setPixelRatio(window.devicePixelRatio);
      this.renderer.setViewport(0, 0, view.width, view.height);

      this.renderer.autoClearDepth = false;
      this.renderer.autoClearStencil = false;
      this.renderer.autoClearColor = false;

      const originalSetRenderTarget = this.renderer.setRenderTarget.bind(
        this.renderer
      );
      this.renderer.setRenderTarget = function(target) {
        originalSetRenderTarget(target);
        if (target == null) {
          context.bindRenderTarget();
        }
      };

      this.scene = new THREE.Scene();

      // setup the camera
      this.camera = new THREE.PerspectiveCamera();

      // setup scene lighting
      this.ambient = new THREE.AmbientLight(0xffffff, 0.5);
      this.scene.add(this.ambient);
      this.sun = new THREE.DirectionalLight(0xffffff, 0.5);
      this.scene.add(this.sun);

      const carMeshUrl = "assets/Porsche_911_GT2.obj";
      const loader = new THREE.OBJLoader(THREE.DefaultLoadingManager);
      loader.load(
        carMeshUrl,
        object3d => {
          console.log("Car mesh loaded.");
          this.car = object3d;
          this.car.scale.set(this.carScale, this.carScale, this.carScale);

          this.scene.add(this.car);
        },
        undefined,
        error => {
          console.error("Error loading Car mesh. ", error);
        }
      );

      this.loadCarTrack();
      context.resetWebGLState();
    },

    render: function(context) {



      view.environment.lighting.date = Date.now();
      const l = context.sunLight;
      this.sun.position.set(l.direction[0], l.direction[1], l.direction[2]);
      this.sun.intensity = l.diffuse.intensity;
      this.sun.color = new THREE.Color(
        l.diffuse.color[0],
        l.diffuse.color[1],
        l.diffuse.color[2]
      );

      this.ambient.intensity = l.ambient.intensity;
      this.ambient.color = new THREE.Color(
        l.ambient.color[0],
        l.ambient.color[1],
        l.ambient.color[2]
      );
      this.renderer.resetGLState();
      this.renderer.render(this.scene, this.camera);
      externalRenderers.requestRender(view);
      context.resetWebGLState();
    },

    loadCarTrack: function() {
      fetch("data/10.txt")
        .then(response => {
          return response.text();
        })
        .then(data => {
          const dataList = data.split(/[\r\n]/);
          dataList.forEach(positionInfo => {
            if (positionInfo !== "") {
              const posInfoData = positionInfo.split(",");
              const time = new Date(posInfoData[1]).getTime();
              this.positionHistory.push({
                pos: [posInfoData[2], posInfoData[3], 10],
                time: time
              });
            }
          });
        });
    },

    queryCarPosition: function () {
      let vel = [0, 0];



    }
  };

  externalRenderers.add(view, issExternalRenderer);
});
