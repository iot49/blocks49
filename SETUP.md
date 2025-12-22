# Rail49 Setup

Rail49 is software that detects the location of trains in a model railroad. It does this with an overhead camera (similar to a satellite) and then using a neural network classifier to detect the presence of trains at specific location (markers).

## Components

The project comprises the following parts:

* Frontend: A static webapp running typically on a smartphone that records the model railroad, saves views in ".r49" files, offers the user to pick marker locations, and runs a classifier at the marker locations. In live mode, the images are recorded continuously (at typically 0.5 to 10 fps) and runs the classifier at all marker locations. The frontend is also used to collect training data for the classifier.

* Classifier: A fastai/Python framework to train the classifier and export it to the frontend.

* Datasets: A collection of datasets for training classifiers related to detection the presence and location of model railroad trains.

* Backend: A python app for controlling trains using the outputs from the frontend. Communication between the frontend and backend is with secure MQTT.

Additional components may be added at a later stage.

## Tooling

* GitHub monorepo, https://github.com/iot49/rails49.git.
* Antigravity IDE.
    * VS Code workspaces if required
    * relevant VS Code extensions (python, browser, etc)
    * direnv for automatically managing (virtual) environments
    * Python:
        * astral.sh tooling:
        * uv package manager 
        * ruff linter
        * [ty](https://github.com/astral-sh/ty) type checker. Note: at the present time apparently supports only a single python environment. Hence presumably the same python environment must be used for all python sub-projects (classifier, backend)
* lit/vite/typescript for the frontend
